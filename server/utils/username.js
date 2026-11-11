function generateUniqueUsername(firstName, lastName) {
  const first = (typeof firstName === "string" ? firstName : "").trim().toLowerCase();
  const last = (typeof lastName === "string" ? lastName : "").trim().toLowerCase();

  let baseUsername = "";
  if (first && last && first !== last) {
    baseUsername = `${first[0]}${last}`.replace(/[^a-z0-9_]/g, "_");
  } else if (first || last) {
    baseUsername = (first || last).replace(/[^a-z0-9_]/g, "_");
  } else {
    baseUsername = "user";
  }

  baseUsername = baseUsername.slice(0, 25) || "user";

  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let randomSuffix = "";
  for (let i = 0; i < 4; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `${baseUsername}_${randomSuffix}`;
}

module.exports = {
  generateUniqueUsername,
};
