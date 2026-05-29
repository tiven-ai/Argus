import bcrypt from 'bcryptjs'

const ROUNDS = 10 // 10 ≈ 100ms on a modern CPU; balance for registration UX

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // bcrypt.compare throws on malformed hashes; the sentinel `$local$` we set
  // for the default-user row falls in that category. Treat any throw as "no".
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}
