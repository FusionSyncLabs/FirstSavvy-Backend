const express = require('express');
const { ApiError } = require('../errorHandler');

const adminBodyParsers = [
  express.json({ limit: '20kb' }),
  express.urlencoded({ extended: true, limit: '20kb' })
];

function adminBodyParserErrorHandler(error, _req, _res, next) {
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return next(new ApiError(413, 'Admin request body exceeds the 20 KB limit.', {
      code: 'PAYLOAD_TOO_LARGE'
    }));
  }

  return next(error);
}

module.exports = { adminBodyParsers, adminBodyParserErrorHandler };
