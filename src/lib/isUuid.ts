const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ルートパラメータが有効なUUID形式かを確認する。Postgresに投げて500になるのを防ぐための入口チェック。 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
