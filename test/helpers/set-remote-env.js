// Sets the fast remote wait cap environment variable before other modules are imported
if (!process.env.DESKTOP_COMMANDER_WAIT_CAP_MS) {
  process.env.DESKTOP_COMMANDER_WAIT_CAP_MS = '2000';
}
