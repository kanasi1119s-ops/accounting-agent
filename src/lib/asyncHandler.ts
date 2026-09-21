import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * async なExpressルートハンドラーをラップし、rejectしたPromiseを next(err) に渡す。
 * Express 4系はasyncハンドラーの例外/rejectを自動キャッチしないため、これを挟まないと
 * 不正な入力（例: UUIDでないIDでのPostgresエラー）でプロセス全体が unhandled rejection で
 * 落ちうる。全ルートでこれを通す。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
