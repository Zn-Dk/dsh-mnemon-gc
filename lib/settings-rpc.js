/**
 * dsh-mnemon-gc settings RPC handler（纯逻辑，可单测）。
 * 把 DSH 的 SettingsService（describe/mutate）包装成 client 可调用的 RPC。
 * 与 dsh-mnemon 的 createSettingsHandler 同构，但 namespace 固定为 'dsh-mnemon-gc'。
 */

export const SETTINGS_NAMESPACE = 'dsh-mnemon-gc'
export const SETTINGS_CHANNEL = '/dsh-mnemon-gc-settings'

const MUTABLE_FIELDS = ['threshold', 'maxAgeDays', 'intervalMs', 'limit', 'detectMaxTokens', 'cliPath', 'dataDir']

/** 失败响应（统一形状）。 */
function failure(error, namespace = SETTINGS_NAMESPACE) {
  return {
    ok: false,
    error: {
      code: 'settings-rejected',
      message: error instanceof Error ? error.message : String(error),
      details: { ns: namespace },
    },
  }
}

/** 成功响应。 */
function success(value) {
  return { ok: true, value }
}

/** 从 SettingsService.describe 里取本 namespace 的 descriptor。 */
function descriptor(settings) {
  const view = settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === SETTINGS_NAMESPACE)
  if (view === undefined) throw new Error('dsh-mnemon-gc settings namespace is unavailable')
  return {
    status: 'ready',
    value: view.value,
    base: view.base,
    user: view.user,
    revision: view.revision,
    writable: settings.writable,
    mode: 'host',
    applies: view.applies,
  }
}

/** 校验一个 mutation path 是否指向本插件支持的字段。 */
function mutablePath(path) {
  return path.length === 1 && MUTABLE_FIELDS.includes(path[0])
}

/** 创建 settings RPC handler；endpoint ∈ { get, mutate }。 */
export function createSettingsRpcHandler(settings) {
  return async (endpoint, rawPayload) => {
    try {
      if (endpoint === 'get') return success(descriptor(settings))
      if (endpoint !== 'mutate') return { ok: false, error: { code: 'bad-request', message: `unknown settings endpoint: ${endpoint}`, details: { issues: [] } } }
      if (!settings.writable) return failure(new Error('DSH settings are read-only'))

      const payload = rawPayload ?? {}
      if (typeof payload !== 'object' || Array.isArray(payload)) return failure(new Error('payload must be an object'))
      if (!Array.isArray(payload.ops) || payload.ops.length === 0 || payload.ops.length > 16) {
        return failure(new Error('ops must contain 1..16 settings edits'))
      }

      const ops = payload.ops.map((raw) => {
        const op = raw ?? {}
        const path = Array.isArray(op.path) ? op.path.map((segment) => String(segment)) : []
        if (!mutablePath(path)) throw new Error(`unsupported settings field: ${path.join('.')}`)
        if (op.op === 'unset') return { op: 'unset', path }
        if (op.op !== 'set') throw new Error(`unsupported settings operation: ${String(op.op)}`)
        return { op: 'set', path, value: op.value }
      })

      const revision = payload.expectedRevision === undefined ? undefined : Number(payload.expectedRevision)
      await settings.mutate(SETTINGS_NAMESPACE, ops, revision)
      return success(descriptor(settings))
    } catch (error) {
      return failure(error)
    }
  }
}
