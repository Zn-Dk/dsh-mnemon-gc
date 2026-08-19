/**
 * dsh-mnemon-gc 客户端 bundle。
 * 通过 settings.section slot 注册一个「Mnemon GC」设置卡片，
 * 读写 host 侧 /dsh-mnemon-gc-settings 通道（6 个配置字段）。
 *
 * bundle 契约：window.__ModuleLoader__.load 格式，只能 require
 * react / react/jsx-runtime / @deepseek-ai/dsh-client-ui-primitives 种子。
 */
window.__ModuleLoader__.load({
  id: "dsh-mnemon-gc",
  factory: (require) => {
    const bundleModule = { exports: {} }
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" })
    const react = require("react")
    const jsx = require("react/jsx-runtime").jsx
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives")

    const SETTINGS_CHANNEL = "/dsh-mnemon-gc-settings"
    const FIELDS = [
      { key: "threshold", label: "有效重要性阈值", type: "number", min: 0, step: 0.05, help: "低于该值才可能成为 GC 候选" },
      { key: "maxAgeDays", label: "无访问天数阈值", type: "number", min: 0, step: 1, help: "无访问超过 N 天才算 stale" },
      { key: "intervalMs", label: "自动巡检间隔(ms)", type: "number", min: 60000, step: 3600000, help: "最小 60s，最大 30 天" },
      { key: "limit", label: "候选上限", type: "number", min: 1, step: 1, help: "每个 store 最多返回 N 个候选" },
      { key: "cliPath", label: "mnemon CLI 路径", type: "text", help: "留空交给 dsh-mnemon 解析" },
      { key: "dataDir", label: "数据目录", type: "text", help: "留空用 global(~/.mnemon)，非空切 custom scope" },
    ]

    function SettingsCard({ connection }) {
      const [snapshot, setSnapshot] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [saving, setSaving] = react.useState(false)

      const load = react.useCallback(async () => {
        try {
          const res = await connection.rpc.call(SETTINGS_CHANNEL, "get", {})
          if (!res.ok) throw new Error(res.error.message)
          setSnapshot(res.value)
          setError(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }, [connection])

      react.useEffect(() => { void load() }, [load])

      const saveField = async (key, value) => {
        setSaving(true)
        setError(null)
        try {
          const res = await connection.rpc.call(SETTINGS_CHANNEL, "mutate", {
            ops: [{ op: "set", path: [key], value }],
            ...(snapshot?.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
          })
          if (!res.ok) throw new Error(res.error.message)
          setSnapshot(res.value)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setSaving(false)
        }
      }

      const current = snapshot?.value ?? {}

      return jsx("div", {
        style: { display: "flex", flexDirection: "column", gap: "14px", maxWidth: 720, width: "100%", color: "var(--dsw-alias-label-primary)", fontFamily: "inherit" },
        children: [
          jsx("h1", { style: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: "24px" }, children: "Mnemon GC 记忆治理" }),
          jsx("p", { style: { margin: 0, fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)" }, children: "控制 mnemon 记忆体的保留巡检：巡检只读报告，清理需显式触发（工具或命令）。" }),
          snapshot === null ? jsx("p", { children: "加载中…" }) : null,
          error ? jsx("p", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: 12, lineHeight: 18, margin: 0 }, children: error }) : null,
          ...FIELDS.map((field) => {
            const value = current[field.key]
            return jsx("label", {
              key: field.key,
              style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, lineHeight: 18 },
              children: [
                jsx("strong", { style: { fontWeight: 500 }, children: field.label }),
                jsx("small", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 10, lineHeight: 16 }, children: field.help }),
                jsx("input", {
                  type: field.type,
                  min: field.min,
                  step: field.step,
                  value: value === undefined || value === null ? "" : String(value),
                  onChange: (e) => {
                    const raw = e.target.value
                    const parsed = field.type === "number" ? (raw === "" ? undefined : Number(raw)) : raw
                    void saveField(field.key, parsed)
                  },
                  disabled: saving || snapshot === null,
                  style: {
                    border: "1px solid var(--dsw-alias-border-l2)",
                    width: "100%",
                    minWidth: 0,
                    height: 36,
                    color: "var(--dsw-alias-label-primary)",
                    background: "var(--dsw-alias-bg-layer-3)",
                    font: "inherit",
                    borderRadius: 9,
                    outline: "none",
                    padding: "0 10px",
                    fontSize: 12,
                  },
                }),
              ],
            })
          }),
          snapshot?.status === "unavailable" ? jsx("p", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: 12 }, children: "settings 通道不可用（host 未加载本插件？）" }) : null,
          saving ? jsx("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "保存中…" }) : null,
        ],
      })
    }

    const inject = ["slots", "connection"]

    function apply(ctx) {
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "mnemon-gc",
        order: 20.5,
        label: () => "Mnemon GC",
        inject: () => ({ connection: ctx.connection }),
      }, SettingsCard))
    }

    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    return bundleModule.exports
  },
})
