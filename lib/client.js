/**
 * dsh-mnemon-gc 客户端 bundle。
 * 通过 settings.section slot 注册一个「Mnemon GC」设置卡片。
 * 排版对齐 dsh-mnemon 的 MnemonSettingsCard 规范：
 *   page(720px, gap 28px) → pageHeader(h1 16px + p 14px) / section(gap 12px,
 *   sectionHeading h2 14px + p 12px) → 字段 grid(2列, gap 12px) →
 *   单字段 label(10px 字号, gap 4px) + input(36px 高)。
 */
window.__ModuleLoader__.load({
  id: "dsh-mnemon-gc",
  factory: (require) => {
    const bundleModule = { exports: {} }
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" })
    const react = require("react")
    const jsx = require("react/jsx-runtime").jsx

    const SETTINGS_CHANNEL = "/dsh-mnemon-gc-settings"
    const FRESHNESS_CHANNEL = "/dsh-mnemon-gc-freshness"

    const NUMBER_FIELDS = [
      { key: "threshold", label: "有效重要性阈值", help: "低于该值的非免疫记忆才可能成为 GC 候选", min: 0, step: 0.05 },
      { key: "maxAgeDays", label: "无访问天数阈值", help: "无访问超过 N 天才判为 stale（可清理）", min: 0, step: 1 },
      { key: "intervalMs", label: "自动巡检间隔（毫秒）", help: "两次自动巡检的最小间隔，默认 24 小时", min: 60000, step: 3600000 },
      { key: "limit", label: "候选数量上限", help: "每次巡检每个 store 最多返回的候选数", min: 1, step: 1 },
    ]
    const PATH_FIELDS = [
      { key: "cliPath", label: "mnemon CLI 路径", help: "留空则由 dsh-mnemon 按标准路径解析" },
      { key: "dataDir", label: "数据目录", help: "留空使用全局 ~/.mnemon；填写后切到 custom 作用域" },
    ]

    const css = [
      ".gc_page{box-sizing:border-box;width:100%;min-width:0;max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:28px;padding-bottom:28px;font-family:inherit;display:flex}",
      ".gc_page *{box-sizing:border-box}",
      ".gc_pageHeader h1{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
      ".gc_pageHeader p{max-width:64ch;color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:14px;line-height:22px}",
      ".gc_section{flex-direction:column;gap:12px;min-width:0;display:flex}",
      ".gc_sectionHeading>div{flex:1;min-width:0}",
      ".gc_sectionHeading h2{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}",
      ".gc_sectionHeading p{max-width:66ch;color:var(--dsw-alias-label-tertiary);margin:1px 0 0;font-size:12px;line-height:18px}",
      ".gc_fieldGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0;display:grid}",
      ".gc_fieldGrid>label{min-width:0;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:10px;line-height:16px;display:flex}",
      ".gc_fieldGrid>label>input{border:1px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:36px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);font:inherit;border-radius:9px;outline:none;padding:0 10px;font-size:12px}",
      ".gc_fieldGrid>label>input:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
      ".gc_fieldGrid>label>input:disabled{cursor:default;opacity:.5}",
      ".gc_fieldGrid>label>small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}",
      ".gc_pathGrid{grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;display:grid}",
      ".gc_pathGrid>label{min-width:0;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:10px;line-height:16px;display:flex}",
      ".gc_pathGrid>label>input{border:1px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:36px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);font:inherit;border-radius:9px;outline:none;padding:0 10px;font-size:12px}",
      ".gc_pathGrid>label>input:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
      ".gc_pathGrid>label>input:disabled{cursor:default;opacity:.5}",
      ".gc_pathGrid>label>small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}",
      ".gc_status{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}",
      ".gc_pending{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
      ".gc_list{flex-direction:column;gap:0;min-width:0;display:flex}",
      ".gc_listRow{display:grid;grid-template-columns:minmax(0,1fr) 56px 56px 72px 72px 60px;gap:8px;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2);padding:8px 0}",
      ".gc_listRow:last-child{border-bottom:none}",
      ".gc_listContent{min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".gc_listCell{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;text-align:right}",
      ".gc_listHead{display:grid;grid-template-columns:minmax(0,1fr) 56px 56px 72px 72px 60px;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 0 6px}",
      ".gc_listHeadCell{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-weight:500;text-align:right}",
      ".gc_listHeadCell:first-child{text-align:left}",
      ".gc_delBtn{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary);font:inherit;font-size:11px;cursor:pointer;background:0 0;border-radius:6px;padding:2px 8px;line-height:16px}",
      ".gc_delBtn:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary)}",
      ".gc_delBtn:disabled{cursor:default;opacity:.5}",
    ].join("")

    // 注入样式（幂等：同 tag 只插一次）。
    if (typeof document !== "undefined") {
      const tagId = "dsh-mnemon-gc/src/client.css"
      if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
        const tag = document.createElement("style")
        tag.dataset.pluginCss = tagId
        tag.textContent = css
        document.head.appendChild(tag)
      }
    }

    /** 单字段输入：本地草稿，blur/Enter 才提交（避免每个按键都打 RPC）。 */
    function FieldInput({ field, value, disabled, onCommit }) {
      const initial = value === undefined || value === null ? "" : String(value)
      const [draft, setDraft] = react.useState(initial)
      react.useEffect(() => { setDraft(initial) }, [initial])
      const isNumber = field.min !== undefined
      const commit = () => {
        if (draft === initial) return
        const parsed = isNumber ? (draft === "" ? undefined : Number(draft)) : draft
        onCommit(field.key, parsed)
      }
      return jsx("input", {
        type: isNumber ? "number" : "text",
        min: field.min,
        step: field.step,
        value: draft,
        disabled,
        onChange: (e) => setDraft(e.target.value),
        onBlur: commit,
        onKeyDown: (e) => { if (e.key === "Enter") commit() },
      })
    }

    /** 记忆新鲜度列表：只读视图 + 单条精确删除（绕过 gc 分级）。 */
    function FreshnessSection({ connection }) {
      const [items, setItems] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [orderBy, setOrderBy] = react.useState('effective_importance')
      const [direction, setDirection] = react.useState('asc')
      const [deleting, setDeleting] = react.useState(false)

      const load = react.useCallback(async () => {
        try {
          const res = await connection.rpc.call(FRESHNESS_CHANNEL, "list", { orderBy, direction })
          if (!res.ok) throw new Error(res.error.message)
          setItems(res.value.items)
          setError(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }, [connection, orderBy, direction])

      react.useEffect(() => { void load() }, [load])

      const forgetOne = async (id) => {
        setDeleting(true)
        setError(null)
        try {
          const res = await connection.rpc.call(FRESHNESS_CHANNEL, "forget", { id })
          if (!res.ok) throw new Error(res.error.message)
          setItems(prev => prev.filter(item => item.id !== id))
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setDeleting(false)
        }
      }

      return jsx("div", {
        className: "gc_section",
        children: [
          jsx("div", {
            className: "gc_sectionHeading",
            children: jsx("div", {
              children: [
                jsx("h2", { children: "记忆新鲜度" }),
                jsx("p", { children: "只读审阅每条记忆的创建时间、被引用次数与有效重要性；删除按 id 精确执行，不做任何自动分级。" }),
              ],
            }),
          }),
          error ? jsx("p", { className: "gc_status", children: error }) : null,
          items === null ? jsx("p", { className: "gc_pending", children: "加载中…" }) : null,
          items !== null && items.length === 0 ? jsx("p", { className: "gc_pending", children: "暂无记忆。" }) : null,
          items !== null && items.length > 0 ? jsx("div", {
            className: "gc_list",
            children: [
              jsx("div", {
                className: "gc_listHead",
                children: [
                  jsx("span", { className: "gc_listHeadCell", children: "内容" }),
                  jsx("span", { className: "gc_listHeadCell", children: "重要度" }),
                  jsx("span", { className: "gc_listHeadCell", children: "引用次数" }),
                  jsx("span", { className: "gc_listHeadCell", children: "创建" }),
                  jsx("span", { className: "gc_listHeadCell", children: "最后访问" }),
                  jsx("span", { className: "gc_listHeadCell", children: "操作" }),
                ],
              }),
              ...items.map((item) => jsx("div", {
                key: item.id,
                className: "gc_listRow",
                children: [
                  jsx("span", { className: "gc_listContent", title: item.content, children: item.content }),
                  jsx("span", { className: "gc_listCell", children: String(item.importance) }),
                  jsx("span", { className: "gc_listCell", children: String(item.accessCount) }),
                  jsx("span", { className: "gc_listCell", children: (item.createdAt || '').slice(0, 10) }),
                  jsx("span", { className: "gc_listCell", children: (item.lastAccessedAt || '').slice(0, 10) }),
                  jsx("button", {
                    className: "gc_delBtn",
                    disabled: deleting,
                    onClick: () => { if (window.confirm('删除这条记忆？（软删除，可追溯）')) void forgetOne(item.id) },
                    children: "删除",
                  }),
                ],
              })),
            ],
          }) : null,
        ],
      })
    }

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
      const disabled = saving || snapshot === null

      if (snapshot?.status === "unavailable") {
        return jsx("div", { className: "gc_page", children: jsx("p", { className: "gc_status", children: "设置通道不可用：宿主未加载 dsh-mnemon-gc。" }) })
      }

      return jsx("div", {
        className: "gc_page",
        children: [
          jsx("div", {
            className: "gc_pageHeader",
            children: [
              jsx("h1", { children: "Mnemon GC 记忆治理" }),
              jsx("p", { children: "巡检只读报告（绝不删除）；清理需显式触发。配置即时热更新。" }),
            ],
          }),
          jsx("div", {
            className: "gc_section",
            children: [
              jsx("div", {
                className: "gc_sectionHeading",
                children: jsx("div", {
                  children: [
                    jsx("h2", { children: "巡检策略" }),
                    jsx("p", { children: "判定哪些低价值、长时间未访问的记忆进入可清理范围。" }),
                  ],
                }),
              }),
              jsx("div", {
                className: "gc_fieldGrid",
                children: NUMBER_FIELDS.map((field) => jsx("label", {
                  key: field.key,
                  children: [
                    jsx("span", { children: field.label }),
                    jsx(FieldInput, { field, value: current[field.key], disabled, onCommit: saveField }),
                    jsx("small", { children: field.help }),
                  ],
                })),
              }),
            ],
          }),
          jsx("div", {
            className: "gc_section",
            children: [
              jsx("div", {
                className: "gc_sectionHeading",
                children: jsx("div", {
                  children: [
                    jsx("h2", { children: "运行位置" }),
                    jsx("p", { children: "mnemon CLI 与数据目录；通常无需填写。" }),
                  ],
                }),
              }),
              jsx("div", {
                className: "gc_pathGrid",
                children: PATH_FIELDS.map((field) => jsx("label", {
                  key: field.key,
                  children: [
                    jsx("span", { children: field.label }),
                    jsx(FieldInput, { field, value: current[field.key], disabled, onCommit: saveField }),
                    jsx("small", { children: field.help }),
                  ],
                })),
              }),
            ],
          }),
          jsx(FreshnessSection, { connection }),
          snapshot === null && error === null ? jsx("p", { className: "gc_pending", children: "加载中…" }) : null,
          error ? jsx("p", { className: "gc_status", children: error }) : null,
          saving ? jsx("p", { className: "gc_pending", children: "保存中…" }) : null,
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
