require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed test users in production.');
  process.exit(1);
}

const bcrypt = require('bcrypt');
const { prisma, disconnectDatabase } = require('../config/database');
const { provisionNewUser } = require('../services/provisioning.service');

const PASSWORD = 'dummy123@';
const BCRYPT_ROUNDS = 12;

async function main() {
  let createdCount = 0;
  let updatedCount = 0;
  const existingPasswordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  try {
    for (let index = 1; index <= 30; index += 1) {
      const email = `dummy.user${index}@example.com`;
      const existingUser = await prisma.user.findUnique({ where: { email } });

      if (!existingUser) {
        const provisioned = await provisionNewUser({
          email,
          fullName: `Dummy User ${index}`,
          password: PASSWORD,
          profileType: 'personal',
          phone: null
        });

        await prisma.user.update({
          where: { id: provisioned.user.id },
          data: {
            verified_at: new Date(),
            two_factor_enabled: false,
            two_factor_method: null
          }
        });
        createdCount += 1;
        continue;
      }

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          password_hash: existingPasswordHash,
          verified_at: new Date(),
          deleted_at: null,
          two_factor_enabled: false,
          two_factor_method: null,
          refresh_token_version: { increment: 1 }
        }
      });
      updatedCount += 1;
    }

    console.log(`Test users ready: ${createdCount} created, ${updatedCount} updated.`);
    console.log('Emails: dummy.user1@example.com through dummy.user30@example.com');
    console.log(`Password for all users: ${PASSWORD}`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error('Test user seed failed:', error);
  process.exitCode = 1;
});