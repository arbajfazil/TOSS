
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// DATABASE
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err.message));

const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}));

// AUTH
function createToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password || password.length < 6) {
      return res.status(400).json({
        message: "Enter a username and password of at least 6 characters."
      });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ message: "Username already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword
    });

    res.json({ token: createToken(user), username: user.username });
  } catch {
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    res.json({ token: createToken(user), username: user.username });
  } catch {
    res.status(500).json({ message: "Login failed." });
  }
});

// SOCKET AUTH
io.use((socket, next) => {
  try {
    socket.user = jwt.verify(
      socket.handshake.auth.token,
      process.env.JWT_SECRET
    );
    next();
  } catch {
    next(new Error("Please log in again."));
  }
});

// ROOM DATA
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = String(Math.floor(10000 + Math.random() * 90000));
  } while (rooms.has(code));
  return code;
}

function roomData(room) {
  const predictionsByUsername = {};

  for (const [socketId, prediction] of room.predictions) {
    const name = room.users.get(socketId);
    if (name) predictionsByUsername[name] = prediction;
  }

  return {
    users: [...room.users.values()],
    predictions: predictionsByUsername,
    result: room.result,
    tossedBy: room.tossedBy,
    history: room.history
  };
}

function sendRoomUpdate(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit("room-update", roomData(room));
}

io.on("connection", socket => {
  const username = socket.user.username;

  // CREATE ROOM
  socket.on("create-room", callback => {
    const code = makeCode();

    const room = {
      users: new Map([[socket.id, username]]),
      predictions: new Map(),
      result: null,
      tossedBy: "",
      history: []
    };

    rooms.set(code, room);
    socket.join(code);

    callback({ ok: true, code, ...roomData(room) });
  });

  // JOIN ROOM
  socket.on("join-room", (code, callback) => {
    code = String(code || "").trim();
    const room = rooms.get(code);

    if (!/^\d{5}$/.test(code) || !room) {
      return callback({ ok: false, message: "Room not found." });
    }

    if (room.users.has(socket.id)) {
      return callback({ ok: true, code, ...roomData(room) });
    }

    if (room.users.size >= 2) {
      return callback({ ok: false, message: "This room is full." });
    }

    room.users.set(socket.id, username);
    socket.join(code);

    sendRoomUpdate(code);
    callback({ ok: true, code, ...roomData(room) });
  });

  // MAKE OR CHANGE PREDICTION
  socket.on("make-prediction", (data, callback) => {
    const code = String(data?.code || "");
    const prediction = data?.prediction;
    const room = rooms.get(code);

    if (!room || !room.users.has(socket.id)) {
      return callback?.({ ok: false, message: "Join a room first." });
    }

    if (!["Heads", "Tails"].includes(prediction)) {
      return callback?.({ ok: false, message: "Choose Heads or Tails." });
    }

    if (room.result) {
      return callback?.({
        ok: false,
        message: "This toss is complete. Start a new toss to predict again."
      });
    }

    room.predictions.set(socket.id, prediction);
    sendRoomUpdate(code);
    callback?.({ ok: true });
  });

  // TOSS COIN
 // TOSS COIN
socket.on("toss-coin", (code, callback) => {
  code = String(code || "");
  const room = rooms.get(code);

  if (!room || !room.users.has(socket.id)) {
    return callback?.({
      ok: false,
      message: "Join a room first."
    });
  }

  if (room.users.size !== 2) {
    return callback?.({
      ok: false,
      message: "Waiting for the second player."
    });
  }

  if (room.result) {
    return callback?.({
      ok: false,
      message: "This toss is already complete. Start a new toss."
    });
  }

  // BOTH players must predict
  if (room.predictions.size !== 2) {
    return callback?.({
      ok: false,
      message: "Both players must predict first."
    });
  }

  // IMPORTANT:
  // Toss result is completely RANDOM.
  // It does NOT depend on who clicked Toss Coin.
  const result = Math.random() < 0.5 ? "Heads" : "Tails";

  const tossNumber = room.history.length + 1;

  // Find who predicted correctly
  const winners = [];

  for (const [playerId, prediction] of room.predictions) {
    const playerName = room.users.get(playerId);

    if (prediction === result) {
      winners.push(playerName);
    }
  }

  room.result = result;
  room.tossedBy = username;

  // Save history
  const predictionsByUsername = {};

  for (const [playerId, prediction] of room.predictions) {
    const playerName = room.users.get(playerId);

    if (playerName) {
      predictionsByUsername[playerName] = prediction;
    }
  }

  room.history.unshift({
    number: tossNumber,
    tossedBy: username,
    result: result,
    predictions: predictionsByUsername,
    winners: winners
  });

  // Send the SAME result to BOTH players
  io.to(code).emit("room-update", roomData(room));

  callback?.({
    ok: true,
    result: result
  });
});

  // START NEXT TOSS
  socket.on("next-toss", (code, callback) => {
    code = String(code || "");
    const room = rooms.get(code);

    if (!room || !room.users.has(socket.id)) {
      return callback?.({ ok: false, message: "Join a room first." });
    }

    if (!room.result) {
      return callback?.({ ok: false, message: "Complete the current toss first." });
    }

    room.predictions.clear();
    room.result = null;
    room.tossedBy = "";

    sendRoomUpdate(code);
    callback?.({ ok: true });
  });

  // LEAVE ROOM
  socket.on("leave-room", code => {
    code = String(code || "");
    const room = rooms.get(code);
    if (!room) return;

    room.users.delete(socket.id);
    room.predictions.delete(socket.id);
    socket.leave(code);

    if (room.users.size === 0) {
      rooms.delete(code);
    } else {
      sendRoomUpdate(code);
    }
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        room.predictions.delete(socket.id);

        if (room.users.size === 0) {
          rooms.delete(code);
        } else {
          sendRoomUpdate(code);
        }
      }
    }
  });
});

app.get("/", (req, res) => {
  res.send("Live Coin Toss Backend is Running!");
});
server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});
