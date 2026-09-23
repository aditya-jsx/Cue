// Layout of Pyth's on-chain PriceUpdateV2 Anchor account (pyth-solana-receiver-sdk):
// 8B discriminator, 32B write_authority, VerificationLevel enum (Partial{u8}=2B, Full=1B),
// then PriceFeedMessage: feed_id[32], price i64, conf u64, exponent i32, publish_time i64, ...
export function parsePriceUpdateV2(data: Uint8Array): { publishTimeMs: number; usd: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8 + 32
  const verificationVariant = view.getUint8(offset)
  offset += verificationVariant === 0 ? 2 : 1
  offset += 32 // feed_id, already known from which account we queried
  const price = view.getBigInt64(offset, true)
  offset += 8 + 8 // price, conf
  const exponent = view.getInt32(offset, true)
  offset += 4
  const publishTime = view.getBigInt64(offset, true)

  return {
    publishTimeMs: Number(publishTime) * 1000,
    usd: Number(price) * 10 ** exponent,
  }
}
