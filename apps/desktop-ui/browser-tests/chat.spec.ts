import { expect, test } from './support/fixtures'
import { installLlm } from './support/llm'

test('streams an answer, persists it and restores the chat after reload', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop)
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Enter text...' })
    .fill('Explain browser isolation')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await llm.start()
  expect(JSON.parse(llm.requests[0]!.body).messages).toContainEqual(
    expect.objectContaining({
      role: 'user',
      content: 'Explain browser isolation',
    })
  )
  await llm.chunk('Each test has ')
  await expect(page.getByText('Each test has', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeVisible()
  await llm.chunk('its own context.')
  await llm.finish()
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toHaveCount(0)
  await expect
    .poll(() => desktop.chats[0]?.messages.at(-1)?.content)
    .toBe('Each test has its own context.')
  await page.reload()
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  await expect(
    page
      .getByRole('paragraph')
      .filter({ hasText: 'Each test has its own context.' })
  ).toBeVisible()
})

test('stops an in-flight response and retries from the UI', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop)
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Enter text...' })
    .fill('Count slowly')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await llm.start()
  await llm.chunk('One')
  await expect(page.getByText('One', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect
    .poll(() => desktop.callsOf('cancel_net_task'))
    .toContainEqual({ id: 1 })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await llm.start(1)
  await llm.chunk('One, two, three.', 1)
  await llm.finish(1)
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'One, two, three.' })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toHaveCount(0)
})

test('reports a provider error and recovers on retry', async ({
  page,
  desktop,
  expectDesktopError,
}) => {
  expectDesktopError(
    /LLM request "chat" failed:.*Browser test authorization denied/s
  )
  const llm = installLlm(desktop)
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Enter text...' }).fill('Try again')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await llm.fail()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await llm.start(1)
  await llm.chunk('Recovered answer.', 1)
  await llm.finish(1)
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'Recovered answer.' })
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('attaches a text file from the clipboard and sends its content', async ({
  page,
  desktop,
}) => {
  const llm = installLlm(desktop)
  await page.goto('/')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Ask AI', exact: true })
    .click()
  const input = page.getByRole('textbox', { name: 'Enter text...' })
  await input.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(
      new File(['The launch code is ORCHID.'], 'launch.txt', {
        type: 'text/plain',
      })
    )
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    )
  })
  await expect(
    page.getByText('launch.txt', { exact: true }).first()
  ).toBeVisible()
  await page.getByRole('textbox').last().fill('What is the launch code?')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await llm.start()
  expect(llm.requests[0]!.body).toContain('The launch code is ORCHID.')
  await llm.chunk('The code is ORCHID.')
  await llm.finish()
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'The code is ORCHID.' })
  ).toBeVisible()
  await expect.poll(() => JSON.stringify(desktop.chats)).toContain('launch.txt')
})

for (const decision of ['Allow', 'Deny'] as const) {
  test(`continues the answer after the user chooses ${decision} for a file tool`, async ({
    page,
    desktop,
  }) => {
    const llm = installLlm(desktop)
    desktop.userConfig.llm.models[0]!.canUseTools = true
    const profile = {
      id: 'browser-profile',
      name: 'Browser profile',
      modelId: 'browser-model',
      projectPermissions: {},
      createdAt: 1,
      updatedAt: 1,
      tools: { groups: { files: { isEnabled: true, access: 'ask' as const } } },
    }
    desktop.handle('list_ai_profiles', () => [profile])
    desktop.handle('get_ai_profile', () => profile)
    desktop.handle('read_ai_profile_soul', () => '')
    desktop.handle('list_ai_file_roots', () => [
      { path: 'workspace', read: 'ask', write: 'ask' },
    ])
    desktop.handle('run_ai_file_tool', () => ({
      operation: 'readFile',
      path: 'workspace/note.txt',
      content: 'The project is ready.',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    }))
    await page.goto('/')
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Browser profile', exact: true })
      .click()
    await page
      .getByRole('textbox', { name: 'Enter text...' })
      .fill('Read the project note')
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click()
    await llm.start()
    expect(JSON.parse(llm.requests[0]!.body).tools).toContainEqual(
      expect.objectContaining({
        function: expect.objectContaining({ name: 'read_file' }),
      })
    )
    await llm.toolCall('read_file', { path: 'workspace/note.txt' })
    await expect(
      page.getByRole('button', { name: decision, exact: true })
    ).toBeVisible()
    expect(desktop.callsOf('run_ai_file_tool')).toHaveLength(0)
    await page.getByRole('button', { name: decision, exact: true }).click()
    await llm.start(1)
    const messages = JSON.parse(llm.requests[1]!.body).messages
    expect(messages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'browser-call' })
    )
    if (decision === 'Allow') {
      expect(desktop.callsOf('run_ai_file_tool')).toEqual([
        {
          profileId: profile.id,
          request: expect.objectContaining({
            operation: 'readFile',
            path: 'workspace/note.txt',
          }),
        },
      ])
      expect(JSON.stringify(messages)).toContain('The project is ready.')
    } else {
      expect(desktop.callsOf('run_ai_file_tool')).toHaveLength(0)
    }
    await llm.chunk(
      decision === 'Allow'
        ? 'The note says the project is ready.'
        : 'The file was not read.',
      1
    )
    await llm.finish(1)
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true })
    ).toHaveCount(0)
    await expect(
      page
        .getByRole('paragraph')
        .filter({
          hasText:
            decision === 'Allow'
              ? 'The note says the project is ready.'
              : 'The file was not read.',
        })
    ).toBeVisible()
  })
}
