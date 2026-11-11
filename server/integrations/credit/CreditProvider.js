class CreditProvider {
  async createVerificationSession(_input) {
    throw new Error('createVerificationSession must be implemented by provider');
  }

  async getVerificationStatus(_providerSessionId) {
    throw new Error('getVerificationStatus must be implemented by provider');
  }

  async pullCreditScore(_input) {
    throw new Error('pullCreditScore must be implemented by provider');
  }
}

module.exports = {
  CreditProvider
};
