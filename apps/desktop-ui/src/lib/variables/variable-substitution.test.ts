import { describe, expect, it } from 'vitest'
import {
  missingVariables,
  sampleUrlTemplate,
  substituteVariables,
  variableNameIssue,
  variableReferences,
  variableValuesOf,
  type VariablePlace,
} from '@tyco/shared'
import cases from '../../../../../packages/shared/fixtures/variable-substitution.json'

interface SubstitutionCase {
  name: string
  place: VariablePlace
  template: string
  text?: string
  values: Record<string, string>
  expected?: string
  missing?: string[]
  cycles?: string[]
}

describe('variable substitution', () => {
  it.each(cases as SubstitutionCase[])('$name', (testCase) => {
    const result = substituteVariables(
      testCase.template,
      testCase.values,
      testCase.place,
      testCase.text
    )
    if (testCase.expected !== undefined)
      expect(result).toEqual({ ok: true, value: testCase.expected })
    else if (testCase.cycles)
      expect(result).toEqual({
        ok: false,
        missing: [],
        cycles: testCase.cycles,
      })
    else if (testCase.missing)
      expect(result).toEqual({ ok: false, missing: testCase.missing })
    else expect(result).toMatchObject({ ok: false, missing: [] })
  })

  it('finds references and the ones without a value', () => {
    expect(
      variableReferences('{{var:A}} {{var:B}} {{var:A}} {{var:}}')
    ).toEqual(['A', 'B'])
    expect(
      missingVariables(['{{var:A}}', '{{var:C}} {{var:B}}'], { A: '1' })
    ).toEqual(['C', 'B'])
  })

  it('takes the values of the declared variables and the built-in ones', () => {
    expect(
      variableValuesOf(
        {
          variables: [
            { id: 'notes', name: 'NOTES_DIR' },
            { id: 'api', name: 'LOCAL_API' },
          ],
          variableValues: { notes: '/n', api: ' ', gone: 'x' },
        },
        { userDir: '/sync', deviceId: 'd1' }
      )
    ).toEqual({ NOTES_DIR: '/n', TYCO_USER_DIR: '/sync', TYCO_DEVICE_ID: 'd1' })
  })

  it('checks a new name: pattern, built-in prefix, case-insensitive repeats', () => {
    const variables = [{ id: 'a', name: 'NOTES_DIR' }]
    expect(variableNameIssue('', variables)).toBe('noName')
    expect(variableNameIssue('notes', variables)).toBe('invalidName')
    expect(variableNameIssue('TYCO_X', variables)).toBe('builtinName')
    expect(variableNameIssue('NOTES_DIR', variables)).toBe('nameTaken')
    expect(variableNameIssue('NOTES_DIR', variables, 'a')).toBeUndefined()
    expect(variableNameIssue('API_2', variables)).toBeUndefined()
  })
})

describe('URL templates', () => {
  it('take a variable at the start or in the path, not in the middle of the scheme', () => {
    const isValid = (template: string) => {
      try {
        return /^https?:$/.test(new URL(sampleUrlTemplate(template)).protocol)
      } catch {
        return false
      }
    }
    expect(isValid('{{var:LOCAL_API}}/v1')).toBe(true)
    expect(isValid('https://x.test/{{var:PATH}}?q={{TEXT}}')).toBe(true)
    expect(isValid('ht{{var:X}}tp://x.test')).toBe(false)
    expect(isValid('{{var:HOST}}')).toBe(true)
    expect(isValid('not a url {{var:X}}')).toBe(false)
  })
})
