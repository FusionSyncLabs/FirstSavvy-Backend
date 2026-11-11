require('dotenv').config();

async function main() {
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:5000';

  const seedStatus = await fetch(`${baseUrl}/api/v1/dev/seed-status`).then((r) => r.json());
  console.log('Seed status:', JSON.stringify(seedStatus, null, 2));

  const provision = await fetch(`${baseUrl}/api/v1/dev/provision-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'dev.user@firstsavvy.test',
      fullName: 'Dev User',
      password: 'Password123!'
    })
  }).then((r) => r.json());

  console.log('Provision result:', JSON.stringify(provision, null, 2));

  if (provision?.data?.user?.id) {
    const status = await fetch(`${baseUrl}/api/v1/dev/provision-user/${provision.data.user.id}/status`).then((r) => r.json());
    console.log('Verification:', JSON.stringify(status, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
