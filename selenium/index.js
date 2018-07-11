/* jshint esversion: 6 */

const homeDir = require('os').homedir();
const { existsSync, promises : fs } = require('fs');
const {Builder, By, Key, until} = require('selenium-webdriver');
const memoize = require('memoizee');
const request = require('request-promise-native');
const dateFormat = require('dateformat');

let browserstackCredentials = memoize(
  async () => JSON.parse(await fs.readFile(homeDir + "/" + ".browserstack.json")),
  { promise: true });

let runTests = async function (driver) {
  let testResultsObject;
  try {
    await driver.get('https://arthuredelstein.github.io/resist-fingerprinting-js/test_unprotected.html');
//    await driver.get('file:///home/arthur/resist-fingerprinting-js/test_unprotected.html');
    let body = await driver.findElement(By.tagName('body'));
    let testResultsString = await driver.wait(
      async () => body.getAttribute("data-test-results"),
      10000);
    testResultsObject = JSON.parse(testResultsString);
  } catch (e) {
    console.log(e);
  } finally {
    await driver.quit();
    return testResultsObject;
  }
};

let browserStackDriver = async function (capabilities) {
  let credentials = await browserstackCredentials();
  capabilitiesWithCred = Object.assign({}, capabilities, credentials);
  let driver = new Builder()
      .usingServer('http://hub-cloud.browserstack.com/wd/hub')
      .withCapabilities(capabilitiesWithCred)
      .build();
  return driver;
};

let localDriver = async function (capabilities) {
  return new Builder()
    .withCapabilities(capabilities)
    .forBrowser(capabilities["browser"])
    .build();
};

/*
const browserStackCapabilityList = [
  {
    'browserName' : 'Firefox',
    'browser_version' : '61.0',
    'os' : 'Windows',
    'os_version' : '10',
    'resolution' : '1024x768',
  },
  {
    'browserName' : 'android',
    'device' : 'Samsung Galaxy S8',
    'realMobile' : 'true',
    'os_version' : '7.0',
  },
];
*/

let fetchBrowserstackCapabilities = async function () {
  let credentials = await browserstackCredentials();
  return request("https://api.browserstack.com/automate/browsers.json", {
    'json': true,
    'auth': {
      'user': credentials["browserstack.user"],
      'pass': credentials["browserstack.key"],
      'sendImmediately': true
    }
  });
};

const selectRecentBrowserstackBrowsers = function (allCapabilities) {
  let OSs = new Set();
  let browsers = new Set();
  // Get names of all operating systems and browsers
  for (let { os, browser } of allCapabilities) {
    OSs.add(os);
    browsers.add(browser);
  }
  let selectedCapabilities = [];
  for (let os of OSs) {
    for (let browser of browsers) {
      let capabilities = allCapabilities.filter(c => c.os === os && c.browser === browser);
      // Find recent versions of operating system
      let os_versions_set = new Set();
      for (let { os_version } of capabilities) {
        os_versions_set.add(os_version);
      }
      let os_versions = [... os_versions_set];
      let mobile = os === "android" || os === "ios";
      // Use two most recent os versions.
      let recent_os_versions = (mobile ? os_versions.sort() : os_versions).slice(-2);
      if (recent_os_versions.length > 0) {
        for (let os_version of recent_os_versions) {
          let capabilities2 = capabilities.filter(c => c.os_version === os_version);
          // Use three most recent browser versions or three representative devices
          selectedCapabilities = selectedCapabilities.concat(capabilities2.slice(-3));
        }
      }
    }
  }
  return selectedCapabilities;
};


let runTestsBatch = async function (driverType, capabilityList) {
  let driverConstructor = { browserstack: browserStackDriver,
                            firefox: localDriver,
                            chrome: localDriver }[driverType];
  if (!driverConstructor) {
    throw new Error(`unknown driver type ${driverType}`);
  }
  let all_data = [];
  for (let capabilities of capabilityList) {
    capabilities.browserName = capabilities.browser;
    console.log(capabilities);
    let driver = await driverConstructor(capabilities);
    let timeStarted = new Date().toISOString();
    let fingerprintingResults = await runTests(driver);
    console.log(`${fingerprintingResults ? fingerprintingResults.length : "No"} items received.`);
    all_data.push({ capabilities, fingerprintingResults, timeStarted });
  }
  return all_data;
};

let writeData = async function (data) {
  let dateStub = dateFormat(new Date(), "yyyymmdd_HHMMss", true);
  if (!(existsSync("results"))) {
    await fs.mkdir("results");
  }
  let filePath = `results/results_${dateStub}.json`;
  await fs.writeFile(filePath, JSON.stringify(data));
  console.log(`Wrote results to "${filePath}".`);
};

let main = async function () {
  let driverType = process.argv[2];
  if (driverType === "chromium") {
    driverType = "chrome";
  }
  console.log(driverType);
  let browserPath = process.argv[3];
  let capabilityList;
  if (driverType === "browserstack") {
    capabilityList = selectRecentBrowserstackBrowsers(
      await fetchBrowserstackCapabilities());
  } else if (driverType === "firefox") {
    capabilityList = [{"browser": "firefox"}];
    if (browserPath) {
      capabilityList[0]["moz:firefoxOptions"] = {binary: browserPath};
    }
  } else if (driverType === "chrome") {
    capabilityList = [{"browser": "chrome"}];
  } else {
    throw new Error(`Unknown driver type '${driverType}'.`);
  }
  await writeData(await runTestsBatch(driverType, capabilityList));
};

main();
