const { randomBytes } = require("crypto");

function generateUniqueId() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let randomPart = "";
  
  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor((randomBytes(1)[0] / 256) * chars.length);
    randomPart += chars.charAt(randomIndex);
  }
  
  return `0000${randomPart}`;
}

module.exports = {
  generateUniqueId,
};
