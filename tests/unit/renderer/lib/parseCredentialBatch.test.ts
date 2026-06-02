import { describe, it, expect } from 'vitest'
import { parseCredentialBatch, toTokenJson } from '../../../../src/renderer/lib/parseCredentialBatch'

describe('parseCredentialBatch — card-key format', () => {
  it('parses the ---- delimited 6-field card-key', () => {
    const out = parseCredentialBatch('a@x.com----pw----RT1----CID1----CSEC1----Enterprise')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      email: 'a@x.com',
      refreshToken: 'RT1',
      clientId: 'CID1',
      clientSecret: 'CSEC1',
      provider: 'Enterprise',
    })
  })

  it('accepts Tab and 2+ space delimiters', () => {
    const tab = parseCredentialBatch('a@x.com\tpw\tRT2\tCID2\tCSEC2')
    expect(tab[0].refreshToken).toBe('RT2')
    expect(tab[0].clientId).toBe('CID2')
    const spaced = parseCredentialBatch('a@x.com   pw   RT3   CID3   CSEC3')
    expect(spaced[0].refreshToken).toBe('RT3')
    expect(spaced[0].clientSecret).toBe('CSEC3')
  })

  it('skips blank lines and # comments, parses the rest', () => {
    const text = ['# header comment', '', 'a@x.com----pw----RT----CID----CSEC', '   ', '# trailing'].join('\n')
    const out = parseCredentialBatch(text)
    expect(out).toHaveLength(1)
    expect(out[0].refreshToken).toBe('RT')
  })

  it('infers provider: no clientId/secret -> Google(social); with -> BuilderId(idc)', () => {
    const social = parseCredentialBatch('a@x.com----pw----RTsocial')
    expect(social[0].provider).toBe('Google')
    expect(social[0].clientId).toBeUndefined()
    const idc = parseCredentialBatch('a@x.com----pw----RTidc----CID----CSEC')
    expect(idc[0].provider).toBe('BuilderId')
  })

  it('lets an explicit provider (field 6) win over inference', () => {
    const out = parseCredentialBatch('a@x.com----pw----RT----CID----CSEC----Github')
    expect(out[0].provider).toBe('Github')
  })

  it('drops rows without a refreshToken', () => {
    // field 3 (RT) empty -> dropped
    const out = parseCredentialBatch('a@x.com----pw----\nb@x.com----pw----RTok----CID----CSEC')
    expect(out).toHaveLength(1)
    expect(out[0].refreshToken).toBe('RTok')
  })

  it('parses multiple lines as a batch', () => {
    const out = parseCredentialBatch(
      ['a@x.com----pw----RTa----CIDa----CSECa', 'b@x.com----pw----RTb'].join('\n'),
    )
    expect(out.map((c) => c.refreshToken)).toEqual(['RTa', 'RTb'])
    expect(out[1].provider).toBe('Google') // social inferred for the 2nd
  })

  it('keeps JWT fields intact when a value ends with "-" (5+ dash boundary)', () => {
    // refreshToken / clientSecret are base64url(JWT) and can end with "-".
    // value + "----" => 5+ consecutive dashes; a naive split('----') would
    // truncate the JWT and prepend "-" to the next field. The extra dashes must
    // be returned to the PRECEDING field (mirrors reference splitCredentialLine).
    const rt = 'RT_ends_with_dash-'
    const csec = 'CSEC_ends-'
    const line = `a@x.com----pw----${rt}----CID----${csec}----BuilderId`
    const [c] = parseCredentialBatch(line)
    expect(c.refreshToken).toBe(rt) // trailing "-" preserved, JWT intact
    expect(c.clientId).toBe('CID')
    expect(c.clientSecret).toBe(csec) // trailing "-" preserved
    expect(c.provider).toBe('BuilderId') // not "-BuilderId"
  })

  it('infers idc for a trailing-dash clientSecret with no explicit provider', () => {
    // clientSecret ends with "-", no 6th field: must still infer BuilderId,
    // never social, so the refresh routes to the IdC endpoint (avoids 401).
    const [c] = parseCredentialBatch('a@x.com----pw----RT----CID----CSEC-')
    expect(c.clientSecret).toBe('CSEC-')
    expect(c.provider).toBe('BuilderId')
  })
})

describe('parseCredentialBatch — JSON format', () => {
  it('parses a JSON array, normalizing snake_case', () => {
    const json = JSON.stringify([
      { refreshToken: 'RT1', clientId: 'C1', clientSecret: 'S1', region: 'us-east-1' },
      { refresh_token: 'RT2', client_id: 'C2', client_secret: 'S2' },
    ])
    const out = parseCredentialBatch(json)
    expect(out).toHaveLength(2)
    expect(out[0].refreshToken).toBe('RT1')
    expect(out[1].refreshToken).toBe('RT2')
    expect(out[1].clientId).toBe('C2')
  })

  it('parses a single JSON object', () => {
    const out = parseCredentialBatch(JSON.stringify({ refreshToken: 'RTsolo', provider: 'Enterprise' }))
    expect(out).toHaveLength(1)
    expect(out[0].provider).toBe('Enterprise')
  })

  it('drops JSON entries without a refreshToken', () => {
    const out = parseCredentialBatch(JSON.stringify([{ clientId: 'C' }, { refreshToken: 'RT' }]))
    expect(out).toHaveLength(1)
    expect(out[0].refreshToken).toBe('RT')
  })
})

describe('toTokenJson', () => {
  it('emits a JSON string the single-account import accepts, omitting empties', () => {
    const s = toTokenJson({ refreshToken: 'RT', clientId: 'C', clientSecret: 'S', provider: 'BuilderId' })
    const parsed = JSON.parse(s)
    expect(parsed).toEqual({ refreshToken: 'RT', clientId: 'C', clientSecret: 'S', provider: 'BuilderId' })
  })

  it('never leaks the card-key email or password into the token JSON', () => {
    const [cred] = parseCredentialBatch('secret@x.com----hunter2----RT----CID----CSEC')
    const parsed = JSON.parse(toTokenJson(cred))
    expect(parsed.email).toBeUndefined()
    expect(parsed.password).toBeUndefined()
    expect(JSON.stringify(parsed)).not.toContain('hunter2')
    expect(JSON.stringify(parsed)).not.toContain('secret@x.com')
  })
})
