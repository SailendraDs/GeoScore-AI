import { chromium, Browser, Page, BrowserContext } from 'playwright';

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message?: string;
  screenshot?: string;
}

class GeoScoreWebsiteTester {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private results: TestResult[] = [];
  private baseUrl = 'http://localhost:3000';

  async setup() {
    console.log('🚀 Setting up Playwright browser...');
    this.browser = await chromium.launch({ 
      headless: false, // Show browser for debugging
      slowMo: 1000 // Slow down actions for visibility
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    this.page = await this.context.newPage();
  }

  async teardown() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async addResult(test: string, status: 'PASS' | 'FAIL' | 'SKIP', message?: string) {
    this.results.push({ test, status, message });
    const emoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${emoji} ${test}: ${status}${message ? ` - ${message}` : ''}`);
  }

  async takeScreenshot(name: string) {
    if (this.page) {
      const screenshotPath = `./screenshots/${name}-${Date.now()}.png`;
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      return screenshotPath;
    }
  }

  async testLandingPage() {
    console.log('\n🏠 Testing Landing Page...');
    try {
      await this.page!.goto(this.baseUrl);
      await this.page!.waitForLoadState('networkidle');

      // Check page title
      const title = await this.page!.title();
      if (title.includes('GeoScore')) {
        await this.addResult('Landing Page - Title', 'PASS', `Title: ${title}`);
      } else {
        await this.addResult('Landing Page - Title', 'FAIL', `Expected GeoScore in title, got: ${title}`);
      }

      // Check main heading
      const heading = await this.page!.textContent('h1');
      if (heading?.includes('GeoScore')) {
        await this.addResult('Landing Page - Main Heading', 'PASS');
      } else {
        await this.addResult('Landing Page - Main Heading', 'FAIL', `Heading: ${heading}`);
      }

      // Check for CTA buttons
      const getStartedBtn = await this.page!.locator('text=Get Started').first();
      const signInBtn = await this.page!.locator('text=Sign In').first();
      
      if (await getStartedBtn.isVisible()) {
        await this.addResult('Landing Page - Get Started Button', 'PASS');
      } else {
        await this.addResult('Landing Page - Get Started Button', 'FAIL');
      }

      if (await signInBtn.isVisible()) {
        await this.addResult('Landing Page - Sign In Button', 'PASS');
      } else {
        await this.addResult('Landing Page - Sign In Button', 'FAIL');
      }

      // Check feature cards
      const featureCards = await this.page!.locator('[role="main"] .grid > *').count();
      if (featureCards >= 3) {
        await this.addResult('Landing Page - Feature Cards', 'PASS', `Found ${featureCards} cards`);
      } else {
        await this.addResult('Landing Page - Feature Cards', 'FAIL', `Only found ${featureCards} cards`);
      }

    } catch (error) {
      await this.addResult('Landing Page - General', 'FAIL', `Error: ${error}`);
    }
  }

  async testSignupFlow() {
    console.log('\n📝 Testing Signup Flow...');
    try {
      // Navigate to signup
      await this.page!.click('text=Get Started');
      await this.page!.waitForURL('**/signup');
      
      await this.addResult('Signup - Navigation', 'PASS');

      // Check signup form elements
      const emailInput = this.page!.locator('input[type="email"]');
      const passwordInput = this.page!.locator('input[type="password"]').first();
      const confirmPasswordInput = this.page!.locator('input[type="password"]').nth(1);
      const submitButton = this.page!.locator('button[type="submit"]');

      if (await emailInput.isVisible() && await passwordInput.isVisible() && 
          await confirmPasswordInput.isVisible() && await submitButton.isVisible()) {
        await this.addResult('Signup - Form Elements', 'PASS');
      } else {
        await this.addResult('Signup - Form Elements', 'FAIL');
      }

      // Test form validation
      await submitButton.click();
      await this.page!.waitForTimeout(1000);
      
      const hasErrors = await this.page!.locator('text=*required*').count() > 0 ||
                       await this.page!.locator('text=*must be*').count() > 0;
      
      if (hasErrors) {
        await this.addResult('Signup - Form Validation', 'PASS');
      } else {
        await this.addResult('Signup - Form Validation', 'FAIL', 'No validation errors shown');
      }

    } catch (error) {
      await this.addResult('Signup Flow', 'FAIL', `Error: ${error}`);
    }
  }

  async testLoginFlow() {
    console.log('\n🔐 Testing Login Flow...');
    try {
      // Navigate to login
      await this.page!.goto(`${this.baseUrl}/login`);
      await this.page!.waitForLoadState('networkidle');
      
      await this.addResult('Login - Page Load', 'PASS');

      // Check for mode toggle (Password vs Magic Link)
      const passwordTab = this.page!.locator('text=Password');
      const magicLinkTab = this.page!.locator('text=Magic Link');
      
      if (await passwordTab.isVisible() && await magicLinkTab.isVisible()) {
        await this.addResult('Login - Mode Toggle', 'PASS');
      } else {
        await this.addResult('Login - Mode Toggle', 'FAIL');
      }

      // Test password mode
      await passwordTab.click();
      const emailInput = this.page!.locator('input[type="email"]');
      const passwordInput = this.page!.locator('input[type="password"]');
      const forgotPasswordLink = this.page!.locator('text=Forgot password?');

      if (await emailInput.isVisible() && await passwordInput.isVisible() && 
          await forgotPasswordLink.isVisible()) {
        await this.addResult('Login - Password Mode Elements', 'PASS');
      } else {
        await this.addResult('Login - Password Mode Elements', 'FAIL');
      }

      // Test magic link mode
      await magicLinkTab.click();
      const magicEmailInput = this.page!.locator('input[type="email"]');
      const sendLinkButton = this.page!.locator('button:has-text("Send Magic Link")');

      if (await magicEmailInput.isVisible() && await sendLinkButton.isVisible()) {
        await this.addResult('Login - Magic Link Mode Elements', 'PASS');
      } else {
        await this.addResult('Login - Magic Link Mode Elements', 'FAIL');
      }

    } catch (error) {
      await this.addResult('Login Flow', 'FAIL', `Error: ${error}`);
    }
  }

  async testForgotPasswordFlow() {
    console.log('\n🔑 Testing Forgot Password Flow...');
    try {
      await this.page!.goto(`${this.baseUrl}/forgot-password`);
      await this.page!.waitForLoadState('networkidle');
      
      const heading = await this.page!.textContent('h2');
      if (heading?.includes('Reset your password')) {
        await this.addResult('Forgot Password - Page Load', 'PASS');
      } else {
        await this.addResult('Forgot Password - Page Load', 'FAIL', `Heading: ${heading}`);
      }

      const emailInput = this.page!.locator('input[type="email"]');
      const submitButton = this.page!.locator('button[type="submit"]');
      const backToLoginLink = this.page!.locator('text=Back to login');

      if (await emailInput.isVisible() && await submitButton.isVisible() && 
          await backToLoginLink.isVisible()) {
        await this.addResult('Forgot Password - Form Elements', 'PASS');
      } else {
        await this.addResult('Forgot Password - Form Elements', 'FAIL');
      }

    } catch (error) {
      await this.addResult('Forgot Password Flow', 'FAIL', `Error: ${error}`);
    }
  }

  async testBrandOnboardingFlow() {
    console.log('\n🏢 Testing Brand Onboarding Flow...');
    try {
      await this.page!.goto(`${this.baseUrl}/onboard`);
      await this.page!.waitForLoadState('networkidle');
      
      const heading = await this.page!.textContent('h2');
      if (heading?.includes('Welcome to GeoScore')) {
        await this.addResult('Onboarding - Page Load', 'PASS');
      } else {
        await this.addResult('Onboarding - Page Load', 'FAIL', `Heading: ${heading}`);
      }

      // Check progress steps
      const progressSteps = await this.page!.locator('.flex.items-center.justify-between > *').count();
      if (progressSteps >= 3) {
        await this.addResult('Onboarding - Progress Steps', 'PASS', `Found ${progressSteps} steps`);
      } else {
        await this.addResult('Onboarding - Progress Steps', 'FAIL', `Only found ${progressSteps} steps`);
      }

      // Check form fields
      const brandNameInput = this.page!.locator('input[placeholder*="brand name"]');
      const websiteInput = this.page!.locator('input[type="url"]');
      const descriptionTextarea = this.page!.locator('textarea');

      if (await brandNameInput.isVisible() && await websiteInput.isVisible()) {
        await this.addResult('Onboarding - Form Fields', 'PASS');
      } else {
        await this.addResult('Onboarding - Form Fields', 'FAIL');
      }

    } catch (error) {
      await this.addResult('Brand Onboarding Flow', 'FAIL', `Error: ${error}`);
    }
  }

  async testDashboardAccess() {
    console.log('\n📊 Testing Dashboard Access...');
    try {
      await this.page!.goto(`${this.baseUrl}/dashboard`);
      await this.page!.waitForLoadState('networkidle');
      
      // Should redirect to login if not authenticated
      const currentUrl = this.page!.url();
      if (currentUrl.includes('/login')) {
        await this.addResult('Dashboard - Auth Protection', 'PASS', 'Redirected to login');
      } else if (currentUrl.includes('/dashboard')) {
        // If we reach dashboard, check for content
        const dashboardHeading = await this.page!.textContent('h1');
        if (dashboardHeading?.includes('Dashboard')) {
          await this.addResult('Dashboard - Content Load', 'PASS');
        } else {
          await this.addResult('Dashboard - Content Load', 'FAIL', `Heading: ${dashboardHeading}`);
        }
      } else {
        await this.addResult('Dashboard - Access', 'FAIL', `Unexpected URL: ${currentUrl}`);
      }

    } catch (error) {
      await this.addResult('Dashboard Access', 'FAIL', `Error: ${error}`);
    }
  }

  async testAdminAccess() {
    console.log('\n👑 Testing Admin Access...');
    try {
      await this.page!.goto(`${this.baseUrl}/admin`);
      await this.page!.waitForLoadState('networkidle');
      
      // Should redirect to login if not authenticated
      const currentUrl = this.page!.url();
      if (currentUrl.includes('/login')) {
        await this.addResult('Admin - Auth Protection', 'PASS', 'Redirected to login');
      } else if (currentUrl.includes('/admin')) {
        // If we reach admin, check for content
        const adminHeading = await this.page!.textContent('h1');
        if (adminHeading?.includes('Admin')) {
          await this.addResult('Admin - Content Load', 'PASS');
        } else {
          await this.addResult('Admin - Content Load', 'FAIL', `Heading: ${adminHeading}`);
        }
      } else {
        await this.addResult('Admin - Access', 'FAIL', `Unexpected URL: ${currentUrl}`);
      }

    } catch (error) {
      await this.addResult('Admin Access', 'FAIL', `Error: ${error}`);
    }
  }

  async testResponsiveDesign() {
    console.log('\n📱 Testing Responsive Design...');
    try {
      // Test mobile viewport
      await this.page!.setViewportSize({ width: 375, height: 667 });
      await this.page!.goto(this.baseUrl);
      await this.page!.waitForLoadState('networkidle');
      
      // Check if content is still accessible
      const heading = await this.page!.textContent('h1');
      if (heading?.includes('GeoScore')) {
        await this.addResult('Responsive - Mobile View', 'PASS');
      } else {
        await this.addResult('Responsive - Mobile View', 'FAIL');
      }

      // Reset to desktop
      await this.page!.setViewportSize({ width: 1280, height: 720 });

    } catch (error) {
      await this.addResult('Responsive Design', 'FAIL', `Error: ${error}`);
    }
  }

  async testErrorPages() {
    console.log('\n🚫 Testing Error Handling...');
    try {
      // Test 404 page
      await this.page!.goto(`${this.baseUrl}/nonexistent-page`);
      await this.page!.waitForLoadState('networkidle');
      
      const response = await this.page!.waitForResponse('**/nonexistent-page');
      if (response.status() === 404) {
        await this.addResult('Error Pages - 404 Response', 'PASS');
      } else {
        await this.addResult('Error Pages - 404 Response', 'FAIL', `Status: ${response.status()}`);
      }

    } catch (error) {
      await this.addResult('Error Pages', 'FAIL', `Error: ${error}`);
    }
  }

  async runAllTests() {
    try {
      await this.setup();
      
      console.log('🧪 Starting comprehensive website testing...\n');

      await this.testLandingPage();
      await this.testSignupFlow();
      await this.testLoginFlow();
      await this.testForgotPasswordFlow();
      await this.testBrandOnboardingFlow();
      await this.testDashboardAccess();
      await this.testAdminAccess();
      await this.testResponsiveDesign();
      await this.testErrorPages();

      // Print summary
      console.log('\n' + '='.repeat(50));
      console.log('🎯 TEST SUMMARY');
      console.log('='.repeat(50));
      
      const passed = this.results.filter(r => r.status === 'PASS').length;
      const failed = this.results.filter(r => r.status === 'FAIL').length;
      const skipped = this.results.filter(r => r.status === 'SKIP').length;
      
      console.log(`✅ Passed: ${passed}`);
      console.log(`❌ Failed: ${failed}`);
      console.log(`⏭️ Skipped: ${skipped}`);
      console.log(`📊 Total: ${this.results.length}`);
      
      if (failed > 0) {
        console.log('\n❌ FAILED TESTS:');
        this.results.filter(r => r.status === 'FAIL').forEach(result => {
          console.log(`   • ${result.test}: ${result.message || 'No details'}`);
        });
      }

      console.log('\n🎉 Testing completed!');
      
    } catch (error) {
      console.error('❌ Test runner failed:', error);
    } finally {
      await this.teardown();
    }
  }
}

// Run the tests
const tester = new GeoScoreWebsiteTester();
tester.runAllTests().catch(console.error);