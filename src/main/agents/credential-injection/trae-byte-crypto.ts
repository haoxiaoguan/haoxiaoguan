import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Trae 的 ByteCrypto v1（对照 cockpit-tools trae_account.rs byte_crypto_encrypt_v1）。
// Trae 1.107+ 把 iCubeAuthInfo://* 存储值先过这套私有加密再 JSON.parse：
//   out = PREFIX(6) || randomKey(32) || AES-128-CBC/PKCS7( sha512(plaintext) || plaintext )
//   AES key/iv = sha512( sha512(randomKey) || salt )[0..32]（前 16 = key，次 16 = iv）
//   salt = AES_A XOR AES_B（每字节异或，64 字节）
// 常量与参考逐字节一致；这是纯函数，可用 encrypt→decrypt 往返 + sha512 校验做确定性单测。

const BLOCK_SIZE = 16
const HEADER_LEN = 6
const SHA512_LEN = 64
const RANDOM_KEY_LEN = 32
const PREFIX_AES = Buffer.from([116, 99, 5, 16, 0, 0])
const PREFIX_AES_PRIVATE = Buffer.from([18, 57, 32, 32, 2, 3])

const AES_PRIVATE_A = Buffer.from([
  191, 192, 216, 250, 122, 246, 220, 97, 31, 254, 98, 27, 8, 72, 71, 176, 135, 99, 96, 18, 127,
  101, 203, 104, 211, 102, 191, 125, 37, 72, 150, 156, 51, 229, 121, 35, 17, 153, 141, 177, 110,
  131, 150, 128, 172, 255, 254, 6, 18, 140, 55, 62, 236, 249, 135, 64, 135, 12, 117, 4, 89, 149,
  168, 209,
])
const AES_PRIVATE_B = Buffer.from([
  246, 204, 26, 232, 232, 70, 129, 109, 223, 146, 169, 242, 23, 241, 105, 145, 50, 196, 165, 42,
  254, 120, 3, 54, 244, 207, 209, 85, 53, 6, 138, 106, 175, 148, 31, 204, 186, 186, 165, 182, 87,
  142, 49, 10, 39, 110, 26, 154, 86, 56, 173, 125, 18, 64, 198, 225, 99, 99, 83, 82, 191, 134,
  76, 170,
])
const AES_A = Buffer.from([
  82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251, 124, 227, 57, 130,
  155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203, 84, 123, 148, 50, 166, 194, 35, 61,
  238, 76, 149, 11, 66, 250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109,
  139, 209, 37,
])
const AES_B = Buffer.from([
  31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81, 127, 169, 25,
  181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160, 224, 59, 77, 174, 42, 245, 176, 200,
  235, 187, 60, 131, 83, 153, 97, 23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33,
  12, 125,
])

type ByteCryptoVersion = 'aes' | 'aes_private'

function sha512(data: Buffer): Buffer {
  return createHash('sha512').update(data).digest()
}

function xorSalt(version: ByteCryptoVersion): Buffer {
  const [left, right] = version === 'aes_private' ? [AES_PRIVATE_A, AES_PRIVATE_B] : [AES_A, AES_B]
  const salt = Buffer.alloc(SHA512_LEN)
  for (let i = 0; i < SHA512_LEN; i++) salt[i] = left[i] ^ right[i]
  return salt
}

function deriveKeyIv(keyMaterial: Buffer, version: ByteCryptoVersion): { key: Buffer; iv: Buffer } | null {
  if (keyMaterial.length !== RANDOM_KEY_LEN) return null
  const merged = Buffer.concat([sha512(keyMaterial), xorSalt(version)])
  const mergedHash = sha512(merged)
  return { key: mergedHash.subarray(0, 16), iv: mergedHash.subarray(16, 32) }
}

/** Encrypt plaintext into a base64 ByteCrypto v1 blob (the 'aes' scheme). */
export function byteCryptoEncryptV1(plaintext: string): string {
  const randomKey = randomBytes(RANDOM_KEY_LEN)
  const derived = deriveKeyIv(randomKey, 'aes')
  if (!derived) throw new Error('Trae ByteCrypto 生成密钥失败')
  const plainBuf = Buffer.from(plaintext, 'utf8')
  const payload = Buffer.concat([sha512(plainBuf), plainBuf])
  const cipher = createCipheriv('aes-128-cbc', derived.key, derived.iv)
  cipher.setAutoPadding(true)
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
  return Buffer.concat([PREFIX_AES, randomKey, encrypted]).toString('base64')
}

/** Decrypt a base64 ByteCrypto blob, verifying the embedded sha512. Returns null on any failure. */
export function byteCryptoDecrypt(base64: string): string | null {
  let raw: Buffer
  try {
    raw = Buffer.from(base64, 'base64')
  } catch {
    return null
  }
  if (raw.length <= HEADER_LEN + RANDOM_KEY_LEN) return null
  const header = raw.subarray(0, HEADER_LEN)
  const version: ByteCryptoVersion | null = header.equals(PREFIX_AES)
    ? 'aes'
    : header.equals(PREFIX_AES_PRIVATE)
      ? 'aes_private'
      : null
  if (version === null) return null

  const keyMaterial = raw.subarray(HEADER_LEN, HEADER_LEN + RANDOM_KEY_LEN)
  const ciphertext = raw.subarray(HEADER_LEN + RANDOM_KEY_LEN)
  if (ciphertext.length === 0 || ciphertext.length % BLOCK_SIZE !== 0) return null
  const derived = deriveKeyIv(keyMaterial, version)
  if (!derived) return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', derived.key, derived.iv)
    decipher.setAutoPadding(true)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    if (decrypted.length < SHA512_LEN) return null
    const body = decrypted.subarray(SHA512_LEN)
    if (!sha512(body).equals(decrypted.subarray(0, SHA512_LEN))) return null
    return body.toString('utf8')
  } catch {
    return null
  }
}
