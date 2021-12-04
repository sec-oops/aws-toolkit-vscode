/*!
 * Copyright 2018-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Before/After hooks for all "unit" tests
 */
import * as assert from 'assert'
import { appendFileSync, mkdirpSync, remove } from 'fs-extra'
import { join } from 'path'
import { getLogger, LogLevel } from '../shared/logger'
import { setLogger } from '../shared/logger/logger'
import * as extWindow from '../shared/vscode/window'
import { DefaultTelemetryService } from '../shared/telemetry/defaultTelemetryService'
import { FakeExtensionContext } from './fakeExtensionContext'
import * as fakeTelemetry from './fake/fakeTelemetryService'
import { TestLogger } from './testLogger'
import { FakeAwsContext } from './utilities/fakeAwsContext'
import { initializeComputeRegion } from '../shared/extensionUtilities'
import { SchemaService } from '../shared/schemas'
import { createTestWorkspaceFolder, deleteTestTempDirs } from './testUtil'
import globals, { initialize } from '../shared/extensionGlobals'
import { initializeIconPaths } from '../shared/icons'
import { CodelensRootRegistry } from '../shared/fs/codelensRootRegistry'
import { CloudFormationTemplateRegistry } from '../shared/fs/templateRegistry'

const testReportDir = join(__dirname, '../../../.test-reports')
const testLogOutput = join(testReportDir, 'testLog.log')

// Expectation: Tests are not run concurrently
let testLogger: TestLogger | undefined

before(async function () {
    // Clean up and set up test logs
    try {
        await remove(testLogOutput)
    } catch (e) {}
    mkdirpSync(testReportDir)
    // Set up global telemetry client
    const fakeContext = new FakeExtensionContext()
    // set global storage path
    fakeContext.globalStoragePath = (await createTestWorkspaceFolder('globalStoragePath')).uri.fsPath
    initialize(fakeContext, extWindow.Window.vscode())
    initializeIconPaths(fakeContext)
    const fakeAws = new FakeAwsContext()
    const fakeTelemetryPublisher = new fakeTelemetry.FakeTelemetryPublisher()
    const service = new DefaultTelemetryService(fakeContext, fakeAws, undefined, fakeTelemetryPublisher)
    globals.telemetry = service
    await initializeComputeRegion()
})

after(async function () {
    deleteTestTempDirs()
})

beforeEach(function () {
    // Set every test up so that TestLogger is the logger used by toolkit code
    testLogger = setupTestLogger()
    globals.templateRegistry = new CloudFormationTemplateRegistry()
    globals.codelensRootRegistry = new CodelensRootRegistry()
    globals.schemaService = new SchemaService(globals.context)
})

afterEach(function () {
    // Prevent other tests from using the same TestLogger instance
    teardownTestLogger(this.currentTest?.fullTitle() as string)
    testLogger = undefined
    globals.templateRegistry.dispose()
    globals.codelensRootRegistry.dispose()
})

/**
 * Provides the TestLogger to tests that want to access it.
 * Verifies that the TestLogger instance is still the one set as the toolkit's logger.
 */
export function getTestLogger(): TestLogger {
    const logger = getLogger()
    assert.strictEqual(logger, testLogger, 'The expected test logger is not the current logger')
    assert.ok(testLogger, 'TestLogger was expected to exist')

    return logger!
}

function setupTestLogger(): TestLogger {
    // write the same logger to each channel.
    // That way, we don't have to worry about which channel is being logged to for inspection.
    const logger = new TestLogger()
    setLogger(logger, 'main')
    setLogger(logger, 'channel')
    setLogger(logger, 'debugConsole')

    return logger
}

function teardownTestLogger(testName: string) {
    writeLogsToFile(testName)

    setLogger(undefined, 'main')
    setLogger(undefined, 'channel')
    setLogger(undefined, 'debugConsole')
}

function writeLogsToFile(testName: string) {
    const entries = testLogger?.getLoggedEntries()
    entries?.unshift(`=== Starting test "${testName}" ===`)
    entries?.push(`=== Ending test "${testName}" ===\n\n`)
    appendFileSync(testLogOutput, entries?.join('\n'), 'utf8')
}

export function assertLogsContain(text: string, exactMatch: boolean, severity: LogLevel) {
    assert.ok(
        getTestLogger()
            .getLoggedEntries(severity)
            .some(e =>
                e instanceof Error
                    ? exactMatch
                        ? e.message === text
                        : e.message.includes(text)
                    : exactMatch
                    ? e === text
                    : e.includes(text)
            ),
        `Expected to find "${text}" in the logs as type "${severity}"`
    )
}
