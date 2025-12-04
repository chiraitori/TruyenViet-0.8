const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Capture all requests to see headers
  page.on('request', (request) => {
    if (request.url().includes('/api/v2')) {
      console.log('\n=== REQUEST ===');
      console.log('URL:', request.url());
      console.log('Method:', request.method());
      console.log('Headers:', JSON.stringify(request.headers(), null, 2));
      if (request.postData()) {
        console.log('Body:', request.postData());
      }
    }
  });
  
  page.on('response', async (response) => {
    if (response.url().includes('/api/v2')) {
      console.log('\n=== RESPONSE ===');
      console.log('URL:', response.url());
      console.log('Status:', response.status());
      console.log('Headers:', JSON.stringify(response.headers(), null, 2));
      try {
        const body = await response.json();
        console.log('Body:', JSON.stringify(body, null, 2));
      } catch (e) {
        console.log('Body (text):', await response.text().catch(() => 'N/A'));
      }
    }
  });
  
  await page.goto('https://cuutruyen.net/login');
  await page.waitForLoadState('networkidle');
  
  await page.locator('input').first().fill('chiraitori');
  await page.locator('input[type="password"]').fill('tathaha1');
  await page.getByRole('button', { name: /đăng nhập|login/i }).click();
  
  await page.waitForTimeout(5000);
  
  // Now try to access an API endpoint after login to see what headers are sent
  console.log('\n=== TRYING MANGA API ===');
  await page.goto('https://cuutruyen.net/api/v2/mangas/7');
  await page.waitForTimeout(2000);
  
  await browser.close();
})();
