// Add this before sending "hello" from browser client.
// Pick one code per device/person.
const PPG_ALLOWED_PLAYER_CODES = ["KAS","JAR","RAD","BAB","DZI","JAN","JAS","SUZ"];

let ppgPlayerCode = localStorage.getItem("ppg_player_code");

if (!ppgPlayerCode || !PPG_ALLOWED_PLAYER_CODES.includes(ppgPlayerCode)) {
  ppgPlayerCode = prompt("Player code: " + PPG_ALLOWED_PLAYER_CODES.join(", "), "SUZ");
  ppgPlayerCode = String(ppgPlayerCode || "SUZ").trim().toUpperCase();

  if (!PPG_ALLOWED_PLAYER_CODES.includes(ppgPlayerCode)) {
    ppgPlayerCode = "SUZ";
  }

  localStorage.setItem("ppg_player_code", ppgPlayerCode);
}

const ppgSessionId = crypto.randomUUID();
const ppgLobbyCode = localStorage.getItem("ppg_lobby_code") || "HOME";
localStorage.setItem("ppg_lobby_code", ppgLobbyCode);

// Your hello should include these fields:
const helloPatch = {
  type: "hello",
  playerCode: ppgPlayerCode,
  sessionId: ppgSessionId,
  lobbyCode: ppgLobbyCode
};
