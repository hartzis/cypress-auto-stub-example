function getFixtureName(spec: any) {
  const specName = spec.name
    .replace('integration/', '')
    .replace('.spec.ts', '');
  return `${specName}.api.snapshot.json`;
}

before(() => {
  let polyfill: any;
  /**
   * Cypress does not support monitor Fetch API request right now (see
   * https://github.com/cypress-io/cypress/issues/95), so here we need
   * to manually load a polyfill Fetch to make sure Fetch API will fallback
   * to XHR, which Cypress can monitor.
   */
  const polyfillUrl = 'https://unpkg.com/unfetch/dist/unfetch.umd.js';
  cy.request(polyfillUrl).then(response => {
    polyfill = response.body;
  });
  Cypress.on('window:before:load', win => {
    delete win.fetch;
    (win as any).eval(polyfill);
    win.fetch = (win as any).unfetch;
  });
});

beforeEach(function() {
  const isAutoStubEnabled = Cypress.env('autoRecordEnabled');
  cy.log(`API Auto Recording: ${isAutoStubEnabled ? 'ON' : 'OFF'}`);
  if (isAutoStubEnabled) {
    cy.log('Use real API response.');
  } else {
    cy.log('Use recorded API response.');
  }

  cy._apiData = [];
  cy._apiCount = 0;
  cy.server({
    onRequest: () => {
      cy._apiCount++;
    },
    onResponse: (xhr: any) => {
      /**
       * Sometimes there are some time windows between API requests, e.g. Request1 finishes,
       * but Request2 starts after 100ms, in this case, cy.waitUntilAllAPIFinished() would
       * not work correctly, so when we decrease the counter, we need to have a delay here.
       */
      const delayTime = isAutoStubEnabled ? 500 : 0;
      if (cy._apiCount === 1) {
        setTimeout(() => {
          cy._apiCount--;
        }, delayTime);
      } else {
        cy._apiCount--;
      }

      if (isAutoStubEnabled) {
        // save URL without the host info, because API host might be different between
        // Record and Replay session
        let url = '';
        let matchHostIndex: number = -1;
        const apiHosts = Cypress.env('apiHosts').split(',');
        for (let i = 0; i < apiHosts.length; i++) {
          const host = apiHosts[i].trim();
          if (xhr.url.includes(host)) {
            url = xhr.url.replace(host, '');
            matchHostIndex = i;
            break;
          }
        }

        const method = xhr.method;
        const request = {
          body: xhr.request.body,
        };
        const response = {
          body: xhr.response.body,
        };
        // save API request/response into an array so we can write these info to fixture
        cy._apiData.push({
          url,
          method,
          request,
          response,
          matchHostIndex,
        });
      }
    },
  });

  if (isAutoStubEnabled) {
    const stubAPIPatterns = Cypress.env('stubAPIPatterns').split(',');
    stubAPIPatterns.forEach((pattern: string) => {
      const apiRegex = new RegExp(pattern.trim());
      // let Cypress stub all API requests which match the pattern defined in cypress.json
      cy.route('GET', apiRegex);
      cy.route('POST', apiRegex);
      cy.route('PUT', apiRegex);
      cy.route('DELETE', apiRegex);
    });
  } else {
    const testFileInfo = Cypress.spec;
    const testCaseTitle = this.currentTest.fullTitle();
    const fixtureName = getFixtureName(testFileInfo);
    const apiHosts = Cypress.env('apiHosts').split(',');
    cy.fixture(fixtureName).then((apiRecords: APISnapshotFixture) => {
      apiRecords[testCaseTitle].records.forEach(apiRecord => {
        const fullUrl = `${apiHosts[apiRecord.matchHostIndex].trim()}${
          apiRecord.url
        }`;
        cy.route(apiRecord.method, fullUrl, apiRecord.response.body);
      });
    });
  }
});

afterEach(function() {
  const isAutoStubEnabled = Cypress.env('autoRecordEnabled');
  if (isAutoStubEnabled) {
    const testFileInfo = Cypress.spec;
    const testCaseTitle = this.currentTest.fullTitle();
    const fixtureName = getFixtureName(testFileInfo);
    const fixturePath = `cypress/fixtures/${fixtureName}`;
    cy.log('API recorded', cy._apiData);
    // if fixture file exists, only update the data related to this test case
    cy.task('isFixtureExisted', fixturePath).then(isFixtureExisted => {
      if (isFixtureExisted) {
        cy.readFile(fixturePath).then((apiRecords: APISnapshotFixture) => {
          apiRecords[testCaseTitle] = {
            timestamp: new Date().toJSON(),
            records: cy._apiData,
          };
          cy.writeFile(fixturePath, apiRecords);
        });
      } else {
        cy.writeFile(fixturePath, {
          [testCaseTitle]: {
            timestamp: new Date().toDateString(),
            records: cy._apiData,
          },
        });
      }
    });
  }
});
