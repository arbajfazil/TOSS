
import { useEffect, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";

const API = import.meta.env.VITE_SERVER_URL;

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [socket, setSocket] = useState(null);

  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: "", password: "" });

  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [users, setUsers] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [result, setResult] = useState(null);
  const [tossedBy, setTossedBy] = useState("");
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;

    const newSocket = io(API, { auth: { token } });
    setSocket(newSocket);

    newSocket.on("connect_error", err => {
      setMessage(err.message || "Connection failed.");
    });

    newSocket.on("room-update", data => {
      setUsers(data.users || []);
      setPredictions(data.predictions || {});
      setResult(data.result || null);
      setTossedBy(data.tossedBy || "");
      setHistory(data.history || []);
    });

    return () => newSocket.disconnect();
  }, [token]);

  async function handleAuth(e) {
    e.preventDefault();
    setMessage("");

    try {
      const endpoint = isRegister ? "/api/register" : "/api/login";
      const { data } = await axios.post(`${API}${endpoint}`, form);

      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      setToken(data.token);
      setUsername(data.username);
    } catch (err) {
      setMessage(err.response?.data?.message || "Something went wrong.");
    }
  }

  function logout() {
    if (socket && roomCode) socket.emit("leave-room", roomCode);
    if (socket) socket.disconnect();

    localStorage.removeItem("token");
    localStorage.removeItem("username");

    setToken("");
    setUsername("");
    setSocket(null);
    setRoomCode("");
    setInputCode("");
    setUsers([]);
    setPredictions({});
    setResult(null);
    setTossedBy("");
    setHistory([]);
    setMessage("");
  }

  function createRoom() {
    if (!socket?.connected) {
      setMessage("Connecting to server. Please wait.");
      return;
    }

    socket.emit("create-room", data => {
      if (!data.ok) return setMessage("Could not create room.");

      setRoomCode(data.code);
      setUsers(data.users);
      setPredictions(data.predictions || {});
      setResult(data.result);
      setHistory(data.history || []);
      setMessage("Share this code with the other player.");
    });
  }

  function joinRoom(e) {
    e.preventDefault();

    if (!socket?.connected) {
      setMessage("Connecting to server. Please wait.");
      return;
    }

    socket.emit("join-room", inputCode, data => {
      if (!data.ok) return setMessage(data.message);

      setRoomCode(data.code);
      setUsers(data.users);
      setPredictions(data.predictions || {});
      setResult(data.result);
      setHistory(data.history || []);
      setMessage("You joined the room.");
    });
  }

  function makePrediction(prediction) {
    if (!socket || !roomCode) return;

    socket.emit("make-prediction", { code: roomCode, prediction }, data => {
      if (data && !data.ok) setMessage(data.message);
      else setMessage("");
    });
  }

  function tossCoin() {
    if (!socket || !roomCode) return;

    socket.emit("toss-coin", roomCode, data => {
      if (data && !data.ok) setMessage(data.message);
      else setMessage("");
    });
  }

  function nextToss() {
    if (!socket || !roomCode) return;

    socket.emit("next-toss", roomCode, data => {
      if (data && !data.ok) setMessage(data.message);
      else setMessage("Make your predictions for the next toss!");
    });
  }

  function leaveRoom() {
    if (socket && roomCode) socket.emit("leave-room", roomCode);

    setRoomCode("");
    setUsers([]);
    setPredictions({});
    setResult(null);
    setTossedBy("");
    setHistory([]);
    setMessage("");
  }

  const myPrediction = predictions[username];
  const bothPredicted = users.length === 2 &&
    users.every(name => predictions[name]);

  if (!token) {
    return (
      <main className="page">
        <section className="card auth-card">
          <h1>🪙 Coin Toss</h1>
          <p>Log in and toss a coin with a friend.</p>

          <form onSubmit={handleAuth}>
            <input
              placeholder="Username"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              required
            />

            <input
              type="password"
              placeholder="Password (at least 6 characters)"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              minLength={6}
              required
            />

            <button type="submit">
              {isRegister ? "Register" : "Login"}
            </button>
          </form>

          <p>
            {isRegister ? "Already have an account?" : "New user?"}{" "}
            <span className="link" onClick={() => {
              setIsRegister(!isRegister);
              setMessage("");
            }}>
              {isRegister ? "Login" : "Register"}
            </span>
          </p>

          {message && <p className="message">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <h2>🪙 Coin Toss</h2>
        <div>
          <span>Hi, {username}</span>
          <button className="small-button" onClick={logout}>Logout</button>
        </div>
      </header>

      <section className="card game-card">
        {!roomCode ? (
          <>
            <h1>Let's Toss!</h1>
            <p>Create a room or enter your friend's 5-digit code.</p>

            <button onClick={createRoom}>Generate Code</button>

            <div className="separator">OR</div>

            <form onSubmit={joinRoom} className="join-form">
              <input
                value={inputCode}
                onChange={e => setInputCode(
                  e.target.value.replace(/\D/g, "").slice(0, 5)
                )}
                placeholder="Enter 5-digit code"
                inputMode="numeric"
                maxLength={5}
                required
              />
              <button type="submit">Join Room</button>
            </form>
          </>
        ) : (
          <>
            <h1>Coin Toss</h1>
            <p>Room code</p>
            <div className="code">{roomCode}</div>
            <p className="hint">Share this code with your friend.</p>

            <div className="players">
              <p>Players: {users.length}/2</p>
              {users.map((name, index) => (
                <div className="player-row" key={`${name}-${index}`}>
                  <span className="player">{name}</span>
                  <span className="prediction-status">
                    {predictions[name]
                      ? `Predicted ${predictions[name]}`
                      : "Waiting for prediction"}
                  </span>
                </div>
              ))}
            </div>

            {!result ? (
              <>
                <h3>Predict the result</h3>
                <div className="prediction-buttons">
                  <button
                    className={myPrediction === "Heads" ? "selected" : ""}
                    onClick={() => makePrediction("Heads")}
                    disabled={users.length !== 2}
                  >
                    Heads
                  </button>

                  <button
                    className={myPrediction === "Tails" ? "selected" : ""}
                    onClick={() => makePrediction("Tails")}
                    disabled={users.length !== 2}
                  >
                    Tails
                  </button>
                </div>

                <div className={`coin ${result ? "flipped" : ""}`}>
                  ?
                </div>

                <p className="hint">
                  {users.length !== 2
                    ? "Waiting for the second player..."
                    : myPrediction
                      ? "Your prediction is saved. You can change it before the toss."
                      : "Choose Heads or Tails before tossing."}
                </p>

                <button onClick={tossCoin} disabled={!bothPredicted}>
                  Toss Coin
                </button>

                {!bothPredicted && users.length === 2 && (
                  <p className="hint">
                    Both players must predict before the coin can be tossed.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="coin flipped">
                  {result === "Heads" ? "H" : "T"}
                </div>

                <h2 className="result">{result}!</h2>
                <p>
                  <strong>Tossed by:</strong> {tossedBy}
                </p>

              <div className="prediction-results">
                {users.map(name => {
                  const isCorrect = predictions[name] === result;

                  return (
                    <p key={name}>
                      <strong>{name}</strong>: Predicted{" "}
                      <strong>{predictions[name]}</strong>
                      {" · "}
                      {isCorrect ? (
                        <span className="correct">Correct! 🎉</span>
                      ) : (
                        <span className="wrong">Wrong</span>
                      )}
                    </p>
                  );
                })}
              </div>

                <button onClick={nextToss}>Next Toss</button>
              </>
            )}

            <button className="secondary" onClick={leaveRoom}>
              Leave Room
            </button>

            <div className="history">
              <h2>Toss History</h2>
              <p>Total tosses: <strong>{history.length}</strong></p>

              {history.length === 0 ? (
                <p className="hint">No tosses yet.</p>
              ) : (
                <div className="history-list">
                  {history.map(item => (
                    <div className="history-item" key={item.number}>
                      <h3>Toss #{item.number} — {item.result}</h3>
                      <p>Tossed by: <strong>{item.tossedBy}</strong></p>

                      {Object.entries(item.predictions || {}).map(([name, prediction]) => (
                        <p key={name}>
                          {name} predicted {prediction}
                          {" — "}
                          {prediction === item.result ? "Correct!" : "Incorrect"}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {message && <p className="message">{message}</p>}
      </section>
    </main>
  );
}