#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write

/**
 * GeoScore AI Test Runner
 * Comprehensive test execution with reporting and coverage
 */

interface TestResult {
  file: string
  passed: number
  failed: number
  duration: number
  errors: string[]
}

interface TestSuite {
  name: string
  file: string
  description: string
}

const TEST_SUITES: TestSuite[] = [
  {
    name: "Authentication & Brand Management",
    file: "tests/unit/auth-brand.test.ts",
    description: "Tests for user auth, profiles, brand CRUD operations, and API key management"
  },
  {
    name: "LLM Orchestration & Reports",
    file: "tests/unit/llm-reports.test.ts", 
    description: "Tests for LLM integration, report generation, and brand onboarding"
  },
  {
    name: "Advanced Analytics",
    file: "tests/unit/analytics.test.ts",
    description: "Tests for competitor tracking, schema builder, script serving, and dashboard API"
  },
  {
    name: "Admin & Billing Systems",
    file: "tests/unit/admin-billing.test.ts",
    description: "Tests for admin panel, billing/subscription management, and live monitoring"
  }
]

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
}

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`
}

function printHeader() {
  console.log(colorize('🧪 GeoScore AI Test Suite Runner', 'cyan'))
  console.log(colorize('=' .repeat(50), 'blue'))
  console.log()
}

function printTestSuiteInfo() {
  console.log(colorize('📋 Test Suites:', 'yellow'))
  TEST_SUITES.forEach((suite, index) => {
    console.log(`${colorize(`${index + 1}.`, 'blue')} ${colorize(suite.name, 'bright')}`)
    console.log(`   ${suite.description}`)
    console.log()
  })
}

async function checkEnvironment(): Promise<boolean> {
  console.log(colorize('🔍 Checking Environment...', 'yellow'))
  
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY', 
    'SUPABASE_SERVICE_ROLE_KEY'
  ]
  
  const missing = requiredEnvVars.filter(varName => !Deno.env.get(varName))
  
  if (missing.length > 0) {
    console.log(colorize(`❌ Missing environment variables: ${missing.join(', ')}`, 'red'))
    console.log(colorize('Please set up your environment variables before running tests.', 'yellow'))
    return false
  }
  
  console.log(colorize('✅ Environment check passed', 'green'))
  console.log()
  return true
}

async function runTestSuite(suite: TestSuite): Promise<TestResult> {
  console.log(colorize(`🧪 Running: ${suite.name}`, 'cyan'))
  console.log(colorize('-'.repeat(30), 'blue'))
  
  const startTime = Date.now()
  
  try {
    const cmd = new Deno.Command('deno', {
      args: [
        'test',
        '--allow-net',
        '--allow-env', 
        '--allow-read',
        '--allow-write',
        '--reporter=pretty',
        suite.file
      ],
      stdout: 'piped',
      stderr: 'piped'
    })
    
    const { code, stdout, stderr } = await cmd.output()
    const duration = Date.now() - startTime
    
    const output = new TextDecoder().decode(stdout)
    const errorOutput = new TextDecoder().decode(stderr)
    
    // Parse test results (simplified parsing)
    const lines = output.split('\n')
    let passed = 0
    let failed = 0
    const errors: string[] = []
    
    for (const line of lines) {
      if (line.includes('ok ')) {
        passed++
      } else if (line.includes('FAILED ') || line.includes('error:')) {
        failed++
        errors.push(line.trim())
      }
    }
    
    if (errorOutput) {
      errors.push(errorOutput)
    }
    
    const result: TestResult = {
      file: suite.file,
      passed,
      failed,
      duration,
      errors
    }
    
    if (code === 0) {
      console.log(colorize(`✅ ${suite.name} completed`, 'green'))
      console.log(colorize(`   Passed: ${passed}, Duration: ${duration}ms`, 'green'))
    } else {
      console.log(colorize(`❌ ${suite.name} failed`, 'red'))
      console.log(colorize(`   Passed: ${passed}, Failed: ${failed}, Duration: ${duration}ms`, 'red'))
      if (errors.length > 0) {
        console.log(colorize('   Errors:', 'red'))
        errors.slice(0, 3).forEach(error => {
          console.log(colorize(`     ${error}`, 'red'))
        })
      }
    }
    
    console.log()
    return result
    
  } catch (error) {
    const duration = Date.now() - startTime
    console.log(colorize(`❌ ${suite.name} crashed: ${error.message}`, 'red'))
    console.log()
    
    return {
      file: suite.file,
      passed: 0,
      failed: 1,
      duration,
      errors: [error.message]
    }
  }
}

function generateReport(results: TestResult[]): void {
  console.log(colorize('📊 Test Results Summary', 'cyan'))
  console.log(colorize('=' .repeat(50), 'blue'))
  console.log()
  
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0)
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  const totalTests = totalPassed + totalFailed
  
  console.log(colorize(`Total Tests: ${totalTests}`, 'bright'))
  console.log(colorize(`Passed: ${totalPassed}`, 'green'))
  console.log(colorize(`Failed: ${totalFailed}`, totalFailed > 0 ? 'red' : 'green'))
  console.log(colorize(`Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`, 'blue'))
  console.log()
  
  if (totalFailed === 0) {
    console.log(colorize('🎉 All tests passed!', 'green'))
  } else {
    console.log(colorize('⚠️  Some tests failed. See details above.', 'yellow'))
  }
  
  console.log()
  
  // Detailed breakdown
  console.log(colorize('📋 Detailed Breakdown:', 'yellow'))
  results.forEach((result, index) => {
    const suite = TEST_SUITES[index]
    const status = result.failed === 0 ? colorize('✅ PASS', 'green') : colorize('❌ FAIL', 'red')
    console.log(`${status} ${suite.name}`)
    console.log(`     Passed: ${result.passed}, Failed: ${result.failed}, Duration: ${result.duration}ms`)
  })
  
  console.log()
}

async function saveReport(results: TestResult[]): Promise<void> {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTests: results.reduce((sum, r) => sum + r.passed + r.failed, 0),
      totalPassed: results.reduce((sum, r) => sum + r.passed, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0)
    },
    suites: results.map((result, index) => ({
      name: TEST_SUITES[index].name,
      file: result.file,
      passed: result.passed,
      failed: result.failed,
      duration: result.duration,
      status: result.failed === 0 ? 'PASS' : 'FAIL',
      errors: result.errors
    }))
  }
  
  try {
    await Deno.writeTextFile('test-results.json', JSON.stringify(report, null, 2))
    console.log(colorize('💾 Test report saved to test-results.json', 'blue'))
  } catch (error) {
    console.log(colorize(`⚠️  Failed to save report: ${error.message}`, 'yellow'))
  }
}

async function main() {
  printHeader()
  printTestSuiteInfo()
  
  // Check environment
  const envOk = await checkEnvironment()
  if (!envOk) {
    Deno.exit(1)
  }
  
  // Parse command line arguments
  const args = Deno.args
  const runSpecific = args.includes('--suite')
  const suiteIndex = runSpecific ? parseInt(args[args.indexOf('--suite') + 1]) - 1 : -1
  const verbose = args.includes('--verbose')
  const saveResults = args.includes('--save')
  
  let suitesToRun = TEST_SUITES
  if (runSpecific && suiteIndex >= 0 && suiteIndex < TEST_SUITES.length) {
    suitesToRun = [TEST_SUITES[suiteIndex]]
    console.log(colorize(`Running specific suite: ${suitesToRun[0].name}`, 'yellow'))
    console.log()
  }
  
  console.log(colorize('🚀 Starting test execution...', 'cyan'))
  console.log()
  
  const results: TestResult[] = []
  
  for (const suite of suitesToRun) {
    const result = await runTestSuite(suite)
    results.push(result)
    
    // Small delay between suites
    if (suitesToRun.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  generateReport(results)
  
  if (saveResults) {
    await saveReport(results)
  }
  
  // Exit with error code if any tests failed
  const hasFailures = results.some(r => r.failed > 0)
  if (hasFailures) {
    Deno.exit(1)
  }
}

// Help function
function printHelp() {
  console.log(colorize('GeoScore AI Test Runner', 'cyan'))
  console.log()
  console.log('Usage:')
  console.log('  deno task test                    # Run all test suites')
  console.log('  deno run test-runner.ts           # Run all test suites')
  console.log('  deno run test-runner.ts --suite 1 # Run specific suite (1-4)')
  console.log('  deno run test-runner.ts --save    # Save results to JSON file')
  console.log('  deno run test-runner.ts --help    # Show this help')
  console.log()
  console.log('Available suites:')
  TEST_SUITES.forEach((suite, index) => {
    console.log(`  ${index + 1}. ${suite.name}`)
  })
  console.log()
}

// Handle help flag
if (Deno.args.includes('--help') || Deno.args.includes('-h')) {
  printHelp()
  Deno.exit(0)
}

// Run main function
if (import.meta.main) {
  main().catch(error => {
    console.error(colorize(`Fatal error: ${error.message}`, 'red'))
    Deno.exit(1)
  })
}