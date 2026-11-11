const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRequest(schema) {
  return (req, _res, next) => {
    const errors = [];

    if (schema?.body) {
      errors.push(...validateObject('body', req.body, schema.body));
    }

    if (schema?.params) {
      errors.push(...validateObject('params', req.params, schema.params));
    }

    if (schema?.query) {
      errors.push(...validateObject('query', req.query, schema.query));
    }

    if (errors.length > 0) {
      const primaryMessage = errors[0]?.message || 'Please check your inputs and try again.';
      return next(new ApiError(HTTP_STATUS.BAD_REQUEST, primaryMessage, {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: errors
      }));
    }

    return next();
  };
}

function validateObject(location, value, rules) {
  return Object.entries(rules).flatMap(([field, rule]) => validateField(location, field, value?.[field], rule));
}

function validateField(location, field, fieldValue, rule) {
  const errors = [];
  const isMissing = fieldValue === undefined || fieldValue === null ||
    (typeof fieldValue === 'string' && fieldValue.trim() === '');

  const fieldLabel = field === 'email' ? 'Email address' : field === 'password' ? 'Password' : field.charAt(0).toUpperCase() + field.slice(1);

  if (rule.required && isMissing) {
    errors.push({
      location,
      field,
      message: field === 'email' ? 'Please enter your email address.' : field === 'password' ? 'Please enter your password.' : `${fieldLabel} is required.`
    });
    return errors;
  }

  if (isMissing) {
    return errors;
  }

  if (rule.type === 'array') {
    if (!Array.isArray(fieldValue)) {
      errors.push({ location, field, message: `${fieldLabel} must be an array.` });
    }
    return errors;
  }

  if (rule.type && typeof fieldValue !== rule.type) {
    errors.push({ location, field, message: `${fieldLabel} must be a valid ${rule.type}.` });
    return errors;
  }

  if (rule.type === 'string') {
    if (rule.minLength && fieldValue.length < rule.minLength) {
      errors.push({
        location,
        field,
        message: `${fieldLabel} must be at least ${rule.minLength} characters long.`
      });
    }

    if (rule.maxLength && fieldValue.length > rule.maxLength) {
      errors.push({
        location,
        field,
        message: `${fieldLabel} must not exceed ${rule.maxLength} characters.`
      });
    }

    if (rule.email && !EMAIL_REGEX.test(fieldValue)) {
      errors.push({ location, field, message: 'Please enter a valid email address.' });
    }

    if (rule.uuid && !UUID_REGEX.test(fieldValue)) {
      errors.push({ location, field, message: 'Please provide a valid ID.' });
    }

    if (rule.enum && !rule.enum.includes(fieldValue)) {
      errors.push({
        location,
        field,
        message: `${fieldLabel} must be one of: ${rule.enum.join(', ')}.`
      });
    }
  }

  return errors;
}

module.exports = { validateRequest };
