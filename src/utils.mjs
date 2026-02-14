export function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

export function nowUnix() {
  return Math.floor(Date.now() / 1000);
}
