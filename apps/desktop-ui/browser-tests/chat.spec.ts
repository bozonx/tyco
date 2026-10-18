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
    .poll(() => desktop.callsOf('net_cancel'))
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
