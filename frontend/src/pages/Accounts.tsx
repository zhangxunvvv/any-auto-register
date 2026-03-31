import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  Table,
  Button,
  Input,
  InputNumber,
  Select,
  Tag,
  Space,
  Modal,
  Form,
  message,
  Popconfirm,
  Dropdown,
  Typography,
  Switch,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  ReloadOutlined,
  CopyOutlined,
  LinkOutlined,
  PlusOutlined,
  DownloadOutlined,
  UploadOutlined,
  MoreOutlined,
  DeleteOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons'
import { apiFetch, API_BASE } from '@/lib/utils'
import { normalizeExecutorForPlatform } from '@/lib/registerOptions'

const { Text } = Typography

const STATUS_COLORS: Record<string, string> = {
  registered: 'default',
  trial: 'success',
  subscribed: 'success',
  expired: 'warning',
  invalid: 'error',
}

function LogPanel({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const allLinesRef = useRef<string[]>([])
  const [lineCount, setLineCount] = useState(0)
  const [done, setDone] = useState(false)
  const [trimEnabled, setTrimEnabled] = useState(true)
  const [trimCount, setTrimCount] = useState(10)
  const bottomRef = useRef<HTMLDivElement>(null)

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(allLinesRef.current.join('\n'))
      message.success('日志已复制（全部）')
    } catch {
      message.error('复制失败')
    }
  }

  useEffect(() => {
    if (!taskId) return
    const es = new EventSource(`${API_BASE}/tasks/${taskId}/logs/stream`)
    es.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.line) {
        allLinesRef.current.push(d.line)
        setLineCount((c) => c + 1)
      }
      if (d.done) {
        setDone(true)
        es.close()
        onDone()
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [taskId])

  const { displayLines, hiddenCount } = useMemo(() => {
    const lines = allLinesRef.current
    if (!trimEnabled || trimCount <= 0) return { displayLines: lines, hiddenCount: 0 }
    const boundaries: number[] = []
    lines.forEach((l, i) => {
      if (/开始注册第\s*\d+/.test(l)) boundaries.push(i)
    })
    if (boundaries.length <= trimCount) return { displayLines: lines, hiddenCount: 0 }
    const startIdx = boundaries[boundaries.length - trimCount]
    return { displayLines: lines.slice(startIdx), hiddenCount: boundaries.length - trimCount }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCount, trimEnabled, trimCount])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayLines])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <Space size="small">
          <Switch size="small" checked={trimEnabled} onChange={setTrimEnabled} />
          <span style={{ fontSize: 12, color: '#6b7280' }}>性能模式</span>
          {trimEnabled && (
            <>
              <span style={{ fontSize: 12, color: '#6b7280' }}>显示最近</span>
              <InputNumber size="small" min={1} max={9999} value={trimCount} onChange={(v) => setTrimCount(v || 10)} style={{ width: 60 }} />
              <span style={{ fontSize: 12, color: '#6b7280' }}>个账号日志</span>
            </>
          )}
        </Space>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopyAll} disabled={allLinesRef.current.length === 0}>
          复制全部日志
        </Button>
      </div>
      <div
        className="log-panel"
        style={{
          flex: 1,
          overflow: 'auto',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          fontFamily: 'monospace',
          fontSize: 12,
          minHeight: 200,
          maxHeight: 400,
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
          whiteSpace: 'pre-wrap',
        }}
      >
        {displayLines.length === 0 && <div style={{ color: '#9ca3af' }}>等待日志...</div>}
        {hiddenCount > 0 && (
          <div style={{ color: '#9ca3af', marginBottom: 8, fontStyle: 'italic' }}>
            ... 已隐藏前 {hiddenCount} 个账号的日志 ...
          </div>
        )}
        {displayLines.map((l, i) => (
          <div
            key={i}
            style={{
              lineHeight: 1.5,
              color: l.includes('✓') || l.includes('成功') ? '#059669' : l.includes('✗') || l.includes('失败') || l.includes('错误') ? '#dc2626' : '#1f2937',
            }}
          >
            {l}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {done && <div style={{ fontSize: 12, color: '#10b981', marginTop: 8 }}>注册完成</div>}
    </div>
  )
}

function ActionMenu({ acc, onRefresh }: { acc: any; onRefresh: () => void }) {
  const [actions, setActions] = useState<any[]>([])

  useEffect(() => {
    apiFetch(`/actions/${acc.platform}`)
      .then((d) => setActions(d.actions || []))
      .catch(() => {})
  }, [acc.platform])

  const handleAction = async (actionId: string) => {
    try {
      const r = await apiFetch(`/actions/${acc.platform}/${acc.id}/${actionId}`, {
        method: 'POST',
        body: JSON.stringify({ params: {} }),
      })
      if (!r.ok) {
        message.error(r.error || '操作失败')
        return
      }
      const data = r.data || {}
      if (data.url || data.checkout_url || data.cashier_url) {
        window.open(data.url || data.checkout_url || data.cashier_url, '_blank')
      } else {
        message.success(data.message || '操作成功')
      }
      onRefresh()
    } catch {
      message.error('请求失败')
    }
  }

  const menuItems: MenuProps['items'] = actions.map((a) => ({
    key: a.id,
    label: a.label,
    onClick: () => handleAction(a.id),
  }))

  if (actions.length === 0) return null

  return (
    <Dropdown menu={{ items: menuItems }}>
      <Button type="link" size="small" icon={<MoreOutlined />} />
    </Dropdown>
  )
}

export default function Accounts() {
  const { platform } = useParams<{ platform: string }>()
  const [currentPlatform, setCurrentPlatform] = useState(platform || 'trae')
  const [accounts, setAccounts] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [syncResultOpen, setSyncResultOpen] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)

  const [registerModalOpen, setRegisterModalOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [currentAccount, setCurrentAccount] = useState<any>(null)

  const [registerForm] = Form.useForm()
  const [addForm] = Form.useForm()
  const [detailForm] = Form.useForm()
  const [importText, setImportText] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [registerLoading, setRegisterLoading] = useState(false)
  const [regSubGroups, setRegSubGroups] = useState<any[]>([])
  const [regSubGroupsLoading, setRegSubGroupsLoading] = useState(false)
  const regSubSyncMode = Form.useWatch('sub_sync_mode', registerForm)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [syncTarget, setSyncTarget] = useState<'all' | 'selected'>('all')
  const [syncGroups, setSyncGroups] = useState<any[]>([])
  const [syncGroupId, setSyncGroupId] = useState<number | undefined>(undefined)
  const [syncGroupsLoading, setSyncGroupsLoading] = useState(false)

  useEffect(() => {
    if (platform) setCurrentPlatform(platform)
  }, [platform])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ platform: currentPlatform, page: String(page), page_size: String(pageSize) })
      if (search) params.set('email', search)
      if (filterStatus) params.set('status', filterStatus)
      const data = await apiFetch(`/accounts?${params}`)
      setAccounts(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [currentPlatform, search, filterStatus, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    message.success('已复制')
  }

  const exportCsv = () => {
    const header = 'email,password,status,region,cashier_url,created_at'
    const rows = accounts.map((a) => [a.email, a.password, a.status, a.region, a.cashier_url, a.created_at].join(','))
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentPlatform}_accounts.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = async () => {
    try {
      const params = new URLSearchParams({ platform: currentPlatform, format: 'json' })
      if (filterStatus) params.set('status', filterStatus)
      const res = await fetch(`${API_BASE}/accounts/export?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${currentPlatform}_accounts.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      message.error(`导出失败: ${e.message}`)
    }
  }

  const openSyncModal = async (target: 'all' | 'selected') => {
    setSyncTarget(target)
    setSyncModalOpen(true)
    setSyncGroupsLoading(true)
    setSyncGroups([])
    setSyncGroupId(undefined)
    try {
      const res = await apiFetch('/integrations/sub2api/groups')
      const groups = res.groups || []
      setSyncGroups(groups)
      if (groups.length > 0) setSyncGroupId(groups[0].id)
    } catch (e: any) {
      message.warning(`拉取分组失败: ${e.message}，可不选分组直接同步`)
    } finally {
      setSyncGroupsLoading(false)
    }
  }

  const doSyncToSub = async () => {
    setSyncLoading(true)
    try {
      const body: any = { group_id: syncGroupId || null }
      if (syncTarget === 'selected' && selectedRowKeys.length > 0) {
        body.account_ids = selectedRowKeys.map(Number)
      } else {
        body.platform = currentPlatform
      }
      const res = await apiFetch('/integrations/sub2api/sync', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setSyncModalOpen(false)
      setSyncResult(res)
      setSyncResultOpen(true)
    } catch (e: any) {
      message.error(`同步失败: ${e.message}`)
    } finally {
      setSyncLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    await apiFetch(`/accounts/${id}`, { method: 'DELETE' })
    message.success('删除成功')
    load()
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    await apiFetch('/accounts/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: Array.from(selectedRowKeys) }),
    })
    message.success('批量删除成功')
    setSelectedRowKeys([])
    load()
  }

  const handleDeleteAll = async () => {
    try {
      const res = await apiFetch(`/accounts/all?platform=${currentPlatform}`, { method: 'DELETE' })
      message.success(`已删除 ${res.deleted} 个账号`)
      setSelectedRowKeys([])
      setPage(1)
      load()
    } catch (e: any) {
      message.error(`删除失败: ${e.message}`)
    }
  }

  const handleAdd = async () => {
    const values = await addForm.validateFields()
    await apiFetch('/accounts', {
      method: 'POST',
      body: JSON.stringify({ ...values, platform: currentPlatform }),
    })
    message.success('添加成功')
    setAddModalOpen(false)
    addForm.resetFields()
    load()
  }

  const handleImport = async () => {
    if (!importText.trim()) return
    setImportLoading(true)
    try {
      const lines = importText.trim().split('\n').filter(Boolean)
      const res = await apiFetch('/accounts/import', {
        method: 'POST',
        body: JSON.stringify({ platform: currentPlatform, lines }),
      })
      message.success(`导入成功 ${res.created} 个`)
      setImportModalOpen(false)
      setImportText('')
      load()
    } catch (e: any) {
      message.error(`导入失败: ${e.message}`)
    } finally {
      setImportLoading(false)
    }
  }

  const handleRegister = async () => {
    const values = await registerForm.validateFields()
    setRegisterLoading(true)
    try {
      const cfg = await apiFetch('/config')
      const executorType = normalizeExecutorForPlatform(currentPlatform, cfg.default_executor)
      const res = await apiFetch('/tasks/register', {
        method: 'POST',
        body: JSON.stringify({
          platform: currentPlatform,
          count: values.count,
          concurrency: values.concurrency,
          register_delay_seconds: values.register_delay_seconds || 0,
          executor_type: executorType,
          captcha_solver: cfg.default_captcha_solver || 'yescaptcha',
          proxy: null,
          extra: {
            mail_provider: cfg.mail_provider || 'laoudo',
            sub_sync_mode: values.sub_sync_mode || 'none',
            sub_group_id: values.sub_group_id || null,
            sub_sync_batch_size: values.sub_sync_batch_size || 1,
            laoudo_auth: cfg.laoudo_auth,
            laoudo_email: cfg.laoudo_email,
            laoudo_account_id: cfg.laoudo_account_id,
            yescaptcha_key: cfg.yescaptcha_key,
            moemail_api_url: cfg.moemail_api_url,
            duckmail_address: cfg.duckmail_address,
            duckmail_password: cfg.duckmail_password,
            duckmail_api_url: cfg.duckmail_api_url,
            duckmail_provider_url: cfg.duckmail_provider_url,
            duckmail_bearer: cfg.duckmail_bearer,
            freemail_api_url: cfg.freemail_api_url,
            freemail_admin_token: cfg.freemail_admin_token,
            freemail_username: cfg.freemail_username,
            freemail_password: cfg.freemail_password,
            cfworker_api_url: cfg.cfworker_api_url,
            cfworker_admin_token: cfg.cfworker_admin_token,
            cfworker_domain: cfg.cfworker_domain,
            cfworker_fingerprint: cfg.cfworker_fingerprint,
          },
        }),
      })
      setTaskId(res.task_id)
    } finally {
      setRegisterLoading(false)
    }
  }

  const handleDetailSave = async () => {
    const values = await detailForm.validateFields()
    await apiFetch(`/accounts/${currentAccount.id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    })
    message.success('保存成功')
    setDetailModalOpen(false)
    load()
  }

  const columns: any[] = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (text: string) => (
        <Text copyable={{ text }} style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {text}
        </Text>
      ),
    },
    {
      title: '密码',
      dataIndex: 'password',
      key: 'password',
      render: (text: string) => (
        <Space>
          <Text style={{ fontFamily: 'monospace', fontSize: 12, filter: 'blur(4px)' }}>{text}</Text>
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyText(text)} />
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={STATUS_COLORS[status] || 'default'}>{status}</Tag>,
    },
    {
      title: '地区',
      dataIndex: 'region',
      key: 'region',
      render: (text: string) => text || '-',
    },
    {
      title: '试用链接',
      dataIndex: 'cashier_url',
      key: 'cashier_url',
      render: (url: string) =>
        url ? (
          <Space>
            <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copyText(url)} />
            <Button type="text" size="small" icon={<LinkOutlined />} onClick={() => window.open(url, '_blank')} />
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => (text ? new Date(text).toLocaleDateString() : '-'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => { setCurrentAccount(record); setDetailModalOpen(true); }}>
            详情
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
          <ActionMenu acc={record} onRefresh={load} />
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Input.Search
            placeholder="搜索邮箱..."
            allowClear
            onSearch={setSearch}
            style={{ width: 200 }}
          />
          <Select
            placeholder="状态筛选"
            allowClear
            style={{ width: 120 }}
            onChange={setFilterStatus}
            options={[
              { value: 'registered', label: '已注册' },
              { value: 'trial', label: '试用中' },
              { value: 'subscribed', label: '已订阅' },
              { value: 'expired', label: '已过期' },
              { value: 'invalid', label: '已失效' },
            ]}
          />
          <Text type="secondary">{total} 个账号</Text>
          {selectedRowKeys.length > 0 && (
            <Text type="success">已选 {selectedRowKeys.length} 个</Text>
          )}
        </Space>
        <Space>
          <Popconfirm title={`确认删除 ${currentPlatform} 全部 ${total} 个账号？此操作不可恢复！`} onConfirm={handleDeleteAll}>
            <Button danger icon={<DeleteOutlined />} disabled={total === 0}>全部删除</Button>
          </Popconfirm>
          {selectedRowKeys.length > 0 && (
            <Popconfirm title={`确认删除选中的 ${selectedRowKeys.length} 个账号？`} onConfirm={handleBatchDelete}>
              <Button danger icon={<DeleteOutlined />}>删除 {selectedRowKeys.length} 个</Button>
            </Popconfirm>
          )}
          {selectedRowKeys.length > 0 && (
            <Button
              icon={<CloudUploadOutlined />}
              loading={syncLoading}
              onClick={() => openSyncModal('selected')}
            >
              同步选中到 Sub
            </Button>
          )}
          <Button icon={<CloudUploadOutlined />} loading={syncLoading} onClick={() => openSyncModal('all')} disabled={accounts.length === 0}>
            一键同步到 Sub
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>导入</Button>
          <Dropdown menu={{ items: [
            { key: 'csv', label: '导出 CSV', onClick: exportCsv },
            { key: 'json', label: '导出 JSON', onClick: exportJson },
          ] }}>
            <Button icon={<DownloadOutlined />} disabled={accounts.length === 0}>导出</Button>
          </Dropdown>
          <Button icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>新增</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterModalOpen(true)}>注册</Button>
          <Button icon={<ReloadOutlined spin={loading} />} onClick={load} />
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={accounts}
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{
          current: page,
          pageSize: pageSize,
          total: total,
          showSizeChanger: true,
          pageSizeOptions: ['50', '100', '200', '500', '1000', '2000'],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            if (ps !== pageSize) {
              setPageSize(ps)
              setPage(1)
            } else {
              setPage(p)
            }
          },
        }}
        onRow={(record) => ({
          onDoubleClick: () => {
            setCurrentAccount(record)
            setDetailModalOpen(true)
          },
        })}
      />

      <Modal
        title={`注册 ${currentPlatform}`}
        open={registerModalOpen}
        onCancel={() => { setRegisterModalOpen(false); setTaskId(null); registerForm.resetFields(); }}
        footer={null}
        width={500}
        maskClosable={false}
      >
        {!taskId ? (
          <Form form={registerForm} layout="vertical" onFinish={handleRegister}>
            <Form.Item name="count" label="注册数量" initialValue={1} rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="concurrency" label="并发数" initialValue={1} rules={[{ required: true }]}>
              <InputNumber min={1} max={20} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="register_delay_seconds" label="每个注册延迟(秒)" initialValue={0}>
              <InputNumber min={0} precision={1} step={0.5} style={{ width: '100%' }} placeholder="0 = 不延迟" />
            </Form.Item>
            <Form.Item name="sub_sync_mode" label="注册后同步到 Sub2API" initialValue="none">
              <Select
                options={[
                  { value: 'none', label: '不同步' },
                  { value: 'each', label: '每 N 个上传' },
                  { value: 'batch', label: '注册完毕后统一上传' },
                ]}
                onChange={(v) => {
                  if (v && v !== 'none') {
                    setRegSubGroupsLoading(true)
                    setRegSubGroups([])
                    registerForm.setFieldValue('sub_group_id', undefined)
                    apiFetch('/integrations/sub2api/groups')
                      .then((res) => {
                        const groups = res.groups || []
                        setRegSubGroups(groups)
                        if (groups.length > 0) registerForm.setFieldValue('sub_group_id', groups[0].id)
                      })
                      .catch(() => {})
                      .finally(() => setRegSubGroupsLoading(false))
                  }
                }}
              />
            </Form.Item>
            {regSubSyncMode === 'each' && (
              <Form.Item name="sub_sync_batch_size" label="每注册成功几个上传一次" initialValue={1}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="默认 1，即每成功 1 个就上传" />
              </Form.Item>
            )}
            {regSubSyncMode && regSubSyncMode !== 'none' && (
              <Form.Item name="sub_group_id" label="目标分组">
                <Select
                  placeholder={regSubGroupsLoading ? '正在拉取分组...' : '选择分组（可选）'}
                  loading={regSubGroupsLoading}
                  allowClear
                  options={regSubGroups.map((g: any) => ({
                    value: g.id,
                    label: `${g.name}${g.account_count != null ? ` (${g.account_count} 个账号)` : ''}`,
                  }))}
                />
              </Form.Item>
            )}
            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={registerLoading}>
                开始注册
              </Button>
            </Form.Item>
          </Form>
        ) : (
          <LogPanel taskId={taskId} onDone={() => { load(); }} />
        )}
      </Modal>

      <Modal
        title="手动新增账号"
        open={addModalOpen}
        onCancel={() => { setAddModalOpen(false); addForm.resetFields(); }}
        onOk={handleAdd}
        maskClosable={false}
      >
        <Form form={addForm} layout="vertical">
          <Form.Item name="email" label="邮箱" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="token" label="Token">
            <Input />
          </Form.Item>
          <Form.Item name="cashier_url" label="试用链接">
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="registered">
            <Select
              options={[
                { value: 'registered', label: '已注册' },
                { value: 'trial', label: '试用中' },
                { value: 'subscribed', label: '已订阅' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量导入"
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); setImportText(''); }}
        onOk={handleImport}
        confirmLoading={importLoading}
        maskClosable={false}
      >
        <p style={{ marginBottom: 8, fontSize: 12, color: '#7a8ba3' }}>
          每行格式: <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: 4 }}>email password [cashier_url]</code>
        </p>
        <Input.TextArea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={8}
          style={{ fontFamily: 'monospace' }}
        />
      </Modal>

      <Modal
        title="账号详情"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        onOk={handleDetailSave}
        maskClosable={false}
      >
        {currentAccount && (
          <Form form={detailForm} layout="vertical" initialValues={currentAccount}>
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'registered', label: '已注册' },
                  { value: 'trial', label: '试用中' },
                  { value: 'subscribed', label: '已订阅' },
                  { value: 'expired', label: '已过期' },
                  { value: 'invalid', label: '已失效' },
                ]}
              />
            </Form.Item>
            <Form.Item name="token" label="Token">
              <Input.TextArea rows={2} style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={syncTarget === 'selected' ? `同步选中 ${selectedRowKeys.length} 个账号到 Sub2API` : `同步 ${currentPlatform} 全部账号到 Sub2API`}
        open={syncModalOpen}
        onCancel={() => { setSyncModalOpen(false); setSyncGroupId(undefined); }}
        onOk={doSyncToSub}
        confirmLoading={syncLoading}
        okText="开始同步"
        maskClosable={false}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>选择分组</div>
          <Select
            style={{ width: '100%' }}
            placeholder={syncGroupsLoading ? '正在拉取分组...' : '选择分组（可选）'}
            loading={syncGroupsLoading}
            allowClear
            value={syncGroupId}
            onChange={(v) => setSyncGroupId(v)}
            options={syncGroups.map((g: any) => ({
              value: g.id,
              label: `${g.name}${g.account_count != null ? ` (${g.account_count} 个账号)` : ''}`,
            }))}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#7a8ba3' }}>
            {syncGroups.length > 0
              ? `已拉取 ${syncGroups.length} 个分组，默认选中第一个`
              : syncGroupsLoading
                ? '正在加载分组列表...'
                : '未获取到分组，将直接上传不绑定分组'}
          </div>
        </div>
      </Modal>

      <Modal
        title="同步结果"
        open={syncResultOpen}
        onCancel={() => setSyncResultOpen(false)}
        footer={<Button type="primary" onClick={() => setSyncResultOpen(false)}>确定</Button>}
        width={700}
      >
        {syncResult && (
          <div>
            <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
              <Tag color="success" style={{ fontSize: 14, padding: '4px 12px' }}>
                成功: {syncResult.success_count || 0}
              </Tag>
              <Tag color="error" style={{ fontSize: 14, padding: '4px 12px' }}>
                失败: {syncResult.failed_count || 0}
              </Tag>
              <Tag color="warning" style={{ fontSize: 14, padding: '4px 12px' }}>
                跳过: {syncResult.skipped_count || 0}
              </Tag>
            </div>
            {syncResult.details && syncResult.details.length > 0 && (
              <Table
                rowKey="id"
                dataSource={syncResult.details}
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: false, size: 'small' }}
                columns={[
                  {
                    title: '邮箱',
                    dataIndex: 'email',
                    key: 'email',
                    ellipsis: true,
                    render: (t: string) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{t}</Text>,
                  },
                  {
                    title: '状态',
                    dataIndex: 'success',
                    key: 'success',
                    width: 80,
                    render: (v: boolean) => <Tag color={v ? 'success' : 'error'}>{v ? '成功' : '失败'}</Tag>,
                  },
                  {
                    title: '信息',
                    dataIndex: 'message',
                    key: 'message',
                    ellipsis: true,
                  },
                ]}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
