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
      ".gc_tableTools{display:flex;gap:8px;align-items:center;min-width:0}",
      ".gc_search,.gc_filter,.gc_pageSize{border:1px solid var(--dsw-alias-border-l2);height:32px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);font:inherit;border-radius:7px;outline:none;padding:0 8px;font-size:11px}",
      ".gc_search{flex:1;min-width:0}",
      ".gc_clearBtn,.gc_pageBtn{border:1px solid var(--dsw-alias-border-l2);height:32px;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;border-radius:7px;padding:0 10px;font:inherit;font-size:11px}",
      ".gc_clearBtn:disabled,.gc_pageBtn:disabled{cursor:default;opacity:.5}",
      ".gc_list{flex-direction:column;gap:0;min-width:0;display:flex;overflow-x:auto}",
      ".gc_listRow,.gc_listHead{display:grid;grid-template-columns:28px minmax(180px,1fr) 64px 48px 60px 128px 52px;gap:8px;align-items:center;min-width:620px}",
      ".gc_listRow{border-bottom:1px solid var(--dsw-alias-border-l2);padding:8px 0}",
      ".gc_listRow:last-child{border-bottom:none}",
      ".gc_listContent{min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".gc_contentButton{border:0;background:transparent;cursor:pointer;text-align:left;padding:0;font:inherit}",
      ".gc_listCell{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;text-align:right;min-width:0}",
      ".gc_listHead{border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 0 6px}",
      ".gc_listHeadCell,.gc_sortHead{border:0;color:var(--dsw-alias-label-tertiary);background:transparent;font:inherit;font-size:10px;line-height:16px;font-weight:500;text-align:right;padding:0;white-space:nowrap}",
      ".gc_contentHead{text-align:left}",
      ".gc_selectHead{display:flex;justify-content:center}",
      ".gc_tag{justify-self:end;border-radius:999px;padding:2px 7px;font-size:10px;line-height:15px;white-space:nowrap}",
      ".gc_tagOk{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}",
      ".gc_tagWarn{color:var(--dsw-alias-state-warning-primary);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 14%,transparent)}",
      ".gc_tagProtected{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3)}",
      ".gc_createdCell{white-space:nowrap}",
      ".gc_delBtn{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary);font:inherit;font-size:11px;cursor:pointer;background:0 0;border-radius:6px;padding:2px 8px;line-height:16px;white-space:nowrap}",
      ".gc_delBtn:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary)}",
      ".gc_delBtn:disabled{cursor:default;opacity:.5}",
      ".gc_tableFooter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0}",
      ".gc_pageInfo{color:var(--dsw-alias-label-tertiary);font-size:10px;margin-left:auto}",
      ".gc_errorBox{display:flex;align-items:center;gap:10px}",
      ".gc_retryBtn{border:0;color:var(--dsw-alias-state-error-primary);background:transparent;cursor:pointer;font:inherit;font-size:11px}",
      ".gc_modalBackdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}",
      ".gc_detailDialog{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:20px 24px;max-width:560px;width:100%;max-height:80vh;overflow:auto;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.25)}",
      ".gc_detailDialog h3{margin:0;font-size:15px;font-weight:500}",
      ".gc_detailContent{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:21px}",
      ".gc_detailMeta{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}",
      ".gc_confirmGroup{display:flex;flex-direction:column;gap:4px;font-size:11px;max-height:160px;overflow:auto}",
      ".gc_rejectedGroup strong,.gc_warning{color:var(--dsw-alias-state-error-primary)}",
      ".gc_warning{font-size:12px;margin:0}",
      ".gc_modalActions{display:flex;gap:8px;justify-content:flex-end}",
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

    /** 记忆新鲜度列表：搜索、筛选、分页、排序与受保护的安全删除。 */
    function FreshnessSection({ connection }) {
      const [items, setItems] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [orderBy, setOrderBy] = react.useState('effective_importance')
      const [direction, setDirection] = react.useState('asc')
      const [deleting, setDeleting] = react.useState(false)
      const [selected, setSelected] = react.useState(new Set())
      const [confirmOpen, setConfirmOpen] = react.useState(false)
      const [detail, setDetail] = react.useState(null)
      const [query, setQuery] = react.useState('')
      const [statusFilter, setStatusFilter] = react.useState('all')
      const [page, setPage] = react.useState(1)
      const [pageSize, setPageSize] = react.useState(20)
      const [result, setResult] = react.useState(null)

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
      react.useEffect(() => { setPage(1); setSelected(new Set()) }, [query, statusFilter, pageSize, orderBy, direction])

      const formatDate = (value) => {
        if (!value) return '—'
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return String(value)
        return date.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      }
      const statusLabel = (status) => status === 'superseded' ? '已取代' : status === 'protected' ? '受保护' : '正常'
      const statusClass = (status) => status === 'superseded' ? 'gc_tag gc_tagWarn' : status === 'protected' ? 'gc_tag gc_tagProtected' : 'gc_tag gc_tagOk'
      const toggleSort = (key) => {
        if (orderBy === key) setDirection(prev => prev === 'asc' ? 'desc' : 'asc')
        else { setOrderBy(key); setDirection('asc') }
      }
      const sortMark = (key) => orderBy === key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''
      const visibleItems = (items ?? []).filter(item => {
        const matchesQuery = query.trim() === '' || item.content.toLowerCase().includes(query.trim().toLowerCase())
        return matchesQuery && (statusFilter === 'all' || item.status === statusFilter)
      })
      const pageCount = Math.max(1, Math.ceil(visibleItems.length / pageSize))
      const currentPage = Math.min(page, pageCount)
      const pageItems = visibleItems.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      const pageIds = pageItems.map(item => item.id)
      const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
      const togglePage = () => setSelected(prev => {
        const next = new Set(prev)
        if (allPageSelected) pageIds.forEach(id => next.delete(id))
        else pageIds.forEach(id => next.add(id))
        return next
      })
      const toggleSelect = (id) => setSelected(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      const selectedItems = visibleItems.filter(item => selected.has(item.id))
      const selectedSuperseded = selectedItems.filter(item => item.status === 'superseded')
      const selectedRejected = selectedItems.filter(item => item.status !== 'superseded')

      const forgetOne = async (id) => {
        setDeleting(true); setError(null)
        try {
          const res = await connection.rpc.call(FRESHNESS_CHANNEL, "forget", { id })
          if (!res.ok) throw new Error(res.error.message)
          setItems(prev => prev.filter(item => item.id !== id))
          setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setDeleting(false) }
      }
      const bulkDelete = async () => {
        setDeleting(true); setError(null)
        try {
          const res = await connection.rpc.call(FRESHNESS_CHANNEL, "purge-superseded", { ids: [...selected] })
          if (!res.ok) throw new Error(res.error.message)
          setResult(res.value); setSelected(new Set()); setConfirmOpen(false); await load()
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setDeleting(false) }
      }
      const retry = () => { setError(null); setItems(null); void load() }

      return jsx("div", {
        className: "gc_section",
        children: [
          jsx("div", { className: "gc_sectionHeading", children: jsx("div", { children: [
            jsx("h2", { children: "记忆新鲜度" }),
            jsx("p", { children: "按状态、内容和辅助新鲜度字段人工审阅。状态排序优先展示已取代记忆；删除仍受服务端 superseded 安全边界保护。" }),
          ] }) }),
          error ? jsx("div", { className: "gc_errorBox", children: [jsx("p", { className: "gc_status", children: error }), jsx("button", { className: "gc_retryBtn", onClick: retry, disabled: deleting, children: "重试" })] }) : null,
          result ? jsx("p", { className: "gc_pending", children: `删除完成：成功 ${result.deleted.length} 条，失败 ${result.failed.length} 条，拒绝 ${result.rejected.length} 条。` }) : null,
          items === null && !error ? jsx("p", { className: "gc_pending", children: "加载中…" }) : null,
          items !== null ? jsx("div", { className: "gc_tableTools", children: [
            jsx("input", { className: "gc_search", value: query, placeholder: "搜索记忆内容", onChange: e => setQuery(e.target.value), disabled: deleting }),
            jsx("select", { className: "gc_filter", value: statusFilter, onChange: e => setStatusFilter(e.target.value), disabled: deleting, children: [
              jsx("option", { value: "all", children: "全部状态" }), jsx("option", { value: "superseded", children: "已取代" }), jsx("option", { value: "normal", children: "正常" }), jsx("option", { value: "protected", children: "受保护" }),
            ] }),
            jsx("button", { className: "gc_clearBtn", onClick: () => { setQuery(''); setStatusFilter('all') }, disabled: deleting || (query === '' && statusFilter === 'all'), children: "清空" }),
          ] }) : null,
          items !== null && items.length === 0 ? jsx("p", { className: "gc_pending", children: "暂无记忆。" }) : null,
          items !== null && items.length > 0 && visibleItems.length === 0 ? jsx("p", { className: "gc_pending", children: "没有匹配的记忆。" }) : null,
          items !== null && visibleItems.length > 0 ? jsx("div", { className: "gc_list", children: [
            jsx("div", { className: "gc_listHead", children: [
              jsx("label", { className: "gc_selectHead", title: "全选当前页", children: jsx("input", { type: "checkbox", checked: allPageSelected, onChange: togglePage, disabled: deleting }) }),
              jsx("button", { className: "gc_sortHead gc_contentHead", children: "内容" }),
              jsx("button", { className: "gc_sortHead", onClick: () => toggleSort('state'), children: `状态${sortMark('state')}` }),
              jsx("button", { className: "gc_sortHead", onClick: () => toggleSort('importance'), children: `重要度${sortMark('importance')}` }),
              jsx("button", { className: "gc_sortHead", onClick: () => toggleSort('access_count'), children: `引用次数${sortMark('access_count')}` }),
              jsx("button", { className: "gc_sortHead gc_createdHead", onClick: () => toggleSort('created_at'), children: `创建时间${sortMark('created_at')}` }),
              jsx("span", { className: "gc_listHeadCell", children: "操作" }),
            ] }),
            ...pageItems.map(item => jsx("div", { key: item.id, className: "gc_listRow", children: [
              jsx("input", { type: "checkbox", checked: selected.has(item.id), onChange: () => toggleSelect(item.id), disabled: deleting }),
              jsx("button", { className: "gc_listContent gc_contentButton", title: item.content, onClick: () => setDetail(item), children: item.content }),
              jsx("span", { className: statusClass(item.status), title: item.status === 'protected' ? '重要度高或引用次数多，系统不会将其列为可删除对象' : item.supersededReason || '', children: statusLabel(item.status) }),
              jsx("span", { className: "gc_listCell", children: String(item.importance) }),
              jsx("span", { className: "gc_listCell", children: String(item.accessCount) }),
              jsx("span", { className: "gc_listCell gc_createdCell", title: item.createdAt, children: formatDate(item.createdAt) }),
              jsx("button", { className: "gc_delBtn", disabled: deleting, onClick: () => { if (window.confirm('删除这条记忆？（软删除，可追溯）')) void forgetOne(item.id) }, children: "删除" }),
            ] })),
            jsx("div", { className: "gc_tableFooter", children: [
              jsx("button", { className: "gc_delBtn", disabled: selected.size === 0 || deleting, onClick: () => setConfirmOpen(true), children: `批量删除已选（${selected.size}）` }),
              jsx("span", { className: "gc_pageInfo", children: `第 ${currentPage}/${pageCount} 页，共 ${visibleItems.length} 条` }),
              jsx("select", { className: "gc_pageSize", value: pageSize, onChange: e => setPageSize(Number(e.target.value)), disabled: deleting, children: [jsx("option", { value: 20, children: "20/页" }), jsx("option", { value: 50, children: "50/页" }), jsx("option", { value: 100, children: "100/页" })] }),
              jsx("button", { className: "gc_pageBtn", onClick: () => setPage(p => Math.max(1, p - 1)), disabled: currentPage <= 1 || deleting, children: "上一页" }),
              jsx("button", { className: "gc_pageBtn", onClick: () => setPage(p => Math.min(pageCount, p + 1)), disabled: currentPage >= pageCount || deleting, children: "下一页" }),
            ] }),
          ] }) : null,
          detail ? jsx("div", { className: "gc_modalBackdrop", role: "presentation", onClick: () => setDetail(null), children: jsx("div", { className: "gc_detailDialog", role: "dialog", 'aria-modal': 'true', onClick: e => e.stopPropagation(), children: [
            jsx("h3", { children: "记忆详情" }), jsx("p", { className: "gc_detailContent", children: detail.content }), jsx("p", { className: "gc_detailMeta", children: `创建时间：${formatDate(detail.createdAt)}；状态：${statusLabel(detail.status)}；重要度：${detail.importance}；引用次数：${detail.accessCount}` }), jsx("button", { className: "gc_delBtn", onClick: () => setDetail(null), children: "关闭" }),
          ] }) }) : null,
          confirmOpen ? jsx("div", { className: "gc_modalBackdrop", role: "presentation", children: jsx("div", { className: "gc_detailDialog", role: "dialog", 'aria-modal': 'true', children: [
            jsx("h3", { children: `确认批量删除 ${selected.size} 条记忆？` }),
            selectedSuperseded.length > 0 ? jsx("div", { className: "gc_confirmGroup", children: [jsx("strong", { children: "将删除（已取代）" }), ...selectedSuperseded.map(i => jsx("span", { key: i.id, children: i.content.slice(0, 80) }))] }) : null,
            selectedRejected.length > 0 ? jsx("div", { className: "gc_confirmGroup gc_rejectedGroup", children: [jsx("strong", { children: "拒绝删除（正常/受保护）" }), ...selectedRejected.map(i => jsx("span", { key: i.id, children: i.content.slice(0, 80) }))] }) : null,
            jsx("p", { className: "gc_warning", children: "⚠️ 删除不可恢复。仅已取代记忆会被删除，其余自动拒绝。" }),
            jsx("div", { className: "gc_modalActions", children: [jsx("button", { className: "gc_delBtn", onClick: () => setConfirmOpen(false), children: "取消" }), jsx("button", { className: "gc_delBtn", disabled: deleting || selectedSuperseded.length === 0, onClick: () => void bulkDelete(), children: deleting ? "删除中…" : "确认删除" })] }),
          ] }) }) : null,
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
