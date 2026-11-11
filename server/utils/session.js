const { signJwt } = require("./tokens");
const { randomUUID } = require("crypto");
const { env } = require("../config/env");

function buildSession(user) {
  const accessToken = signJwt(
    {
      sub: user.id,
      email: user.email,
      type: "access",
    },
    env.jwtAccessSecret,
    env.accessTokenTtlSeconds,
  );

  const refreshToken = signJwt(
    {
      sub: user.id,
      type: "refresh",
      tokenVersion: user.refresh_token_version,
      jti: randomUUID(),
    },
    env.jwtRefreshSecret,
    env.refreshTokenTtlSeconds,
  );

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: env.accessTokenTtlSeconds,
  };
}

module.exports = {
  buildSession,
};
