// CuuTruyen Login API Test
// Run with: node test-login.js

const { fetch, Agent } = require('undici');

async function login(username, password) {
  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);

  const response = await fetch('https://cuutruyen.net/api/v2/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://cuutruyen.net',
      'Referer': 'https://cuutruyen.net/login',
    },
    body: formData.toString(),
    dispatcher: new Agent({
      connect: {
        timeout: 30000,
      }
    })
  });

  const data = await response.json();
  return { status: response.status, data };
}

// Test login
login('chiraitori', 'tathaha1')
  .then(result => {
    console.log('Status:', result.status);
    console.log('Response:', JSON.stringify(result.data, null, 2));
    
    if (result.data.auth_token) {
      console.log('\n✅ Login successful!');
      console.log('Auth Token:', result.data.auth_token);
    }
  })
  .catch(err => console.error('Error:', err.message));
