"use client"

import type React from "react"
import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import {
  Users,
  Cookie,
  Activity,
  Settings,
  Search,
  Plus,
  Upload,
  Download,
  Trash2,
  Edit,
  X,
  Lock,
  LogOut,
  Play,
  FileSpreadsheet,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Tv,
  Database,
  XCircle,
  Mail,
  ShoppingCart,
  KeyRound,
} from "lucide-react"
import { addMonthsIso, formatDisplayDate, parseSheet, todayIso, type ParsedRow, type SheetParseResult } from "@/lib/validity"
import { DEFAULT_BRAND, formatWhatsapp } from "@/lib/support"
import { MAX_PLANS, displayPrice, type Plan } from "@/lib/plans"

type AccountStatus = "live" | "expiring_soon" | "expired" | "needs_reimport" | "unverified" | "unknown"

interface Customer {
  id: string
  mobile: string
  netflixEmail: string
  expiryDate: string
  isBlocked: boolean
  totalUpdates: number
  lastUpdateAt: string | null
  tvLoginsThisMonth: number
  linkedAccountId: string | null
  linkedAccountStatus: AccountStatus | null
  history: Array<{
    id: string
    date: string
    action: "tv_login" | "household_update"
    status: string
    code?: string
    notes?: string
  }>
}

interface NetflixAccount {
  id: string
  profileName: string
  accountLabel: string
  accountEmail?: string
  userAgent?: string
  cookies: any[]
  status: AccountStatus
  earliestExpiryIso?: string | null
  lastCheckedAt: string | null
  lastRefreshedAt?: string | null
  lastResult: string | null
  lastDetail: string
}

interface NetflixId {
  email: string
  inbox: string
  customers: number
  activeCustomers: number
  gmailConfigured: boolean
  vaultAccountId: string | null
  vaultStatus: AccountStatus | null
}

interface AppSettings {
  companyName: string
  supportWhatsapp: string
  maxUpdatesPerMonth: number
  logRetentionDays: number
  siteUrl: string
  householdLookbackMinutes: number
  plans: Plan[]
}

interface AdminMailbox {
  id: string | null
  gmailUser: string
  label: string
  source: "panel" | "env"
  lastTestAt: string | null
  lastTestOk: boolean | null
  lastTestMessage: string | null
  secretError?: string
}

interface EnvStatus {
  adminPassword: boolean
  cronSecret: boolean
  encryptionKey: boolean
  legacyGmailInboxes: number
  siteUrl: boolean
}

interface PlanRow {
  months: string
  label: string
  price: string
  enabled: boolean
}

interface Metrics {
  totalSubscribers: number
  activeSubscribers: number
  expiredSubscribers: number
  blockedSubscribers: number
  activationsToday: number
  activationsMonth: number
  totalCookieAccounts: number
  activeCookies: number
  netflixIds: number
  idsMissingGmail: number
}

interface Order {
  orderId: string
  mobile: string
  customerName: string
  customerEmail: string
  planId: string
  planLabel: string
  planMonths: number | null
  amount: number
  status: "created" | "pending" | "paid" | "failed"
  txnId: string | null
  gatewayStatus: string | null
  notes: string | null
  createdAt: string
  paidAt: string | null
}

interface PaypurSummary {
  configured: boolean
  keyHint: string
  saltSet: boolean
  error?: string
}

const TOKEN_KEY = "dreamlabs_admin_token"

const statusLabel = (s: AccountStatus | null) =>
  s === "live"
    ? "Live"
    : s === "expiring_soon"
      ? "Expiring soon"
      : s === "needs_reimport"
        ? "Needs re-import"
        : s === "expired"
          ? "Expired"
          : s === "unverified"
            ? "Unverified"
            : s === "unknown"
              ? "Untested"
              : "No cookies"

const statusTone = (s: AccountStatus | null) =>
  s === "live"
    ? "bg-emerald-500/20 text-emerald-400"
    : s === "expiring_soon" || s === "unverified" || s === "unknown"
      ? "bg-amber-500/20 text-amber-300"
      : "bg-red-500/20 text-red-400"

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState("")
  const [loginError, setLoginError] = useState("")
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"dashboard" | "customers" | "orders" | "ids" | "cookies" | "logs" | "settings">("dashboard")

  // Data states
  const [customers, setCustomers] = useState<Customer[]>([])
  const [netflixCookies, setNetflixCookies] = useState<NetflixAccount[]>([])
  const [netflixIds, setNetflixIds] = useState<NetflixId[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [activationsLog, setActivationsLog] = useState<any[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [paypur, setPaypur] = useState<PaypurSummary | null>(null)
  const [orderBusy, setOrderBusy] = useState<string | null>(null)
  const [orderMsg, setOrderMsg] = useState("")

  // PayPur settings form
  const [paypurKeyInput, setPaypurKeyInput] = useState("")
  const [paypurSaltInput, setPaypurSaltInput] = useState("")
  const [paypurMsg, setPaypurMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("")
  const [customerFilter, setCustomerFilter] = useState<"all" | "active" | "expired" | "cooldown" | "blocked">("all")

  // Modals
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [showBulkImportModal, setShowBulkImportModal] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [bulkParsed, setBulkParsed] = useState<SheetParseResult | null>(null)
  const [bulkMessage, setBulkMessage] = useState("")
  const [bulkBusy, setBulkBusy] = useState(false)

  // Customer Form state
  const [custMobile, setCustMobile] = useState("")
  const [custEmail, setCustEmail] = useState("")
  const [custExpDate, setCustExpDate] = useState("")
  const [custBlocked, setCustBlocked] = useState(false)
  const [formError, setFormError] = useState("")

  // Customer History Modal
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<Customer | null>(null)

  // Cookie Form state
  const [showAddCookieModal, setShowAddCookieModal] = useState(false)
  const [editingCookie, setEditingCookie] = useState<NetflixAccount | null>(null)
  const [cookieProfileName, setCookieProfileName] = useState("")
  const [cookieEmail, setCookieEmail] = useState("")
  const [cookieRawJson, setCookieRawJson] = useState("")
  const [cookieUserAgent, setCookieUserAgent] = useState("")
  const [cookieError, setCookieError] = useState("")
  const [testingCookieId, setTestingCookieId] = useState<string | null>(null)
  const [testingAllCookies, setTestingAllCookies] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{
    provider?: string
    label?: string
    isPersistent?: boolean
    details?: string
  } | null>(null)

  const [storageError, setStorageError] = useState("")

  // Gmail inbox tests (Netflix IDs tab)
  const [mailboxTests, setMailboxTests] = useState<Record<string, { busy?: boolean; ok?: boolean; message?: string }>>({})

  // Settings state
  const [settingsSection, setSettingsSection] = useState<"general" | "gmail" | "payments" | "backup">("general")
  const [generalForm, setGeneralForm] = useState({
    companyName: "",
    supportWhatsapp: "",
    maxUpdatesPerMonth: "2",
    householdLookbackMinutes: "30",
    logRetentionDays: "180",
    siteUrl: "",
  })
  const [generalMsg, setGeneralMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [planRows, setPlanRows] = useState<PlanRow[]>([])
  const [plansMsg, setPlansMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Gmail inboxes (managed here, no longer in Vercel)
  const [mailboxes, setMailboxes] = useState<AdminMailbox[]>([])
  const [mailboxesError, setMailboxesError] = useState<string | null>(null)
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null)
  const [mbxEditingId, setMbxEditingId] = useState<string | null>(null)
  const [mbxUser, setMbxUser] = useState("")
  const [mbxPass, setMbxPass] = useState("")
  const [mbxLabel, setMbxLabel] = useState("")
  const [mbxBusy, setMbxBusy] = useState<string | null>(null)
  const [mbxMsg, setMbxMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // On mount check token
  useEffect(() => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY)
    if (savedToken) {
      setToken(savedToken)
      fetchAdminData(savedToken)
    } else {
      setLoading(false)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError("")
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setToken(data.token)
        sessionStorage.setItem(TOKEN_KEY, data.token)
        fetchAdminData(data.token)
      } else {
        setLoginError(data.message || "Invalid password")
      }
    } catch {
      setLoginError("Failed to connect to server")
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setPasswordInput("")
  }

  const getAuthHeaders = () => {
    const activeToken = token || (typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null) || ""
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeToken}`,
    }
  }

  const fetchAdminData = async (adminToken: string) => {
    setLoading(true)
    try {
      const activeToken = adminToken || (typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null) || ""
      const res = await fetch("/api/admin/data", {
        headers: { Authorization: `Bearer ${activeToken}` },
        cache: "no-store",
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setStorageError("")
        setCustomers(data.data.customers || [])
        setNetflixCookies(data.data.netflixCookies || [])
        setNetflixIds(data.data.netflixIds || [])
        setSettings(data.data.settings || null)
        setActivationsLog(data.data.activationsLog || [])
        setMetrics(data.data.metrics || null)
        setOrders(data.data.orders || [])
        setOrdersError(data.data.ordersError || null)
        setPaypur(data.data.paypur || null)
        if (data.storage) {
          setStorageInfo(data.storage)
        }

        if (data.data.settings) {
          const st: AppSettings = data.data.settings
          setGeneralForm({
            companyName: st.companyName,
            supportWhatsapp: st.supportWhatsapp,
            maxUpdatesPerMonth: String(st.maxUpdatesPerMonth || 2),
            householdLookbackMinutes: String(st.householdLookbackMinutes || 30),
            logRetentionDays: String(st.logRetentionDays || 180),
            siteUrl: st.siteUrl || "",
          })
          setPlanRows(
            (st.plans || []).map((pl) => ({ months: String(pl.months), label: pl.label, price: String(pl.price), enabled: pl.enabled }))
          )
        }
        setMailboxes(data.data.mailboxes || [])
        setMailboxesError(data.data.mailboxesError || null)
        setEnvStatus(data.data.env || null)
      } else if (res.status === 401) {
        handleLogout()
      } else {
        // Never show stale or empty data as if it were real: surface the storage error.
        setStorageError(data.message || `Server error (HTTP ${res.status})`)
        if (data.storage) setStorageInfo(data.storage)
      }
    } catch (err) {
      console.error("Error fetching admin data:", err)
      setStorageError("Could not reach the server")
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    if (token) fetchAdminData(token)
  }

  // TV logins used this calendar month (counted on the server, India time)
  const getCustomerCooldownInfo = (c: Customer) => {
    const max = settings?.maxUpdatesPerMonth ?? 2
    const monthUsed = c.tvLoginsThisMonth || 0
    return { isMonthlyMax: monthUsed >= max, monthUsed, max }
  }

  // Filter customers
  const filteredCustomers = useMemo(() => {
    const today = todayIso()
    return customers.filter((c) => {
      const q = searchQuery.trim().toLowerCase()
      if (q && !c.mobile.includes(q.replace(/\D/g, "") || q) && !c.netflixEmail.toLowerCase().includes(q)) {
        return false
      }

      const isExpired = c.expiryDate && c.expiryDate < today
      const cooldownInfo = getCustomerCooldownInfo(c)

      if (customerFilter === "active") return !isExpired && !c.isBlocked
      if (customerFilter === "expired") return isExpired
      if (customerFilter === "cooldown") return cooldownInfo.isMonthlyMax
      if (customerFilter === "blocked") return c.isBlocked

      return true
    })
  }, [customers, searchQuery, customerFilter, settings])

  // Customer Form submission (Add or Edit)
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError("")

    if (!/^[6-9]\d{9}$/.test(custMobile.replace(/\D/g, ""))) {
      setFormError("Enter a valid 10-digit Indian mobile number")
      return
    }

    try {
      const res = await fetch("/api/admin/customer", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: editingCustomer ? editingCustomer.id : undefined,
          mobile: custMobile,
          netflixEmail: custEmail,
          expiryDate: custExpDate,
          isBlocked: custBlocked,
        }),
      })

      const data = await res.json()
      if (res.ok && data.ok) {
        setShowAddCustomerModal(false)
        setEditingCustomer(null)
        if (data.created === false && !editingCustomer) alert(data.message)
        refresh()
      } else {
        setFormError(data.message || "Failed to save customer")
      }
    } catch {
      setFormError("Network error")
    }
  }

  // Delete customer
  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer?")) return
    try {
      await fetch(`/api/admin/customer?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      })
      refresh()
    } catch {
      alert("Failed to delete customer")
    }
  }

  // Reset the monthly TV login counter
  const handleResetCooldown = async (id: string) => {
    try {
      const res = await fetch("/api/admin/reset-counter", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ customerId: id }),
      })
      const data = await res.json()
      if (data.ok) refresh()
    } catch {
      alert("Failed to reset cooldown")
    }
  }

  // Toggle Block customer
  const handleToggleBlock = async (c: Customer) => {
    try {
      await fetch("/api/admin/customer", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ id: c.id, isBlocked: !c.isBlocked }),
      })
      refresh()
    } catch {
      alert("Failed to update status")
    }
  }

  // Open Edit Customer modal
  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c)
    setCustMobile(c.mobile)
    setCustEmail(c.netflixEmail)
    setCustExpDate(c.expiryDate)
    setCustBlocked(c.isBlocked)
    setFormError("")
    setShowAddCustomerModal(true)
  }

  // Open Add Customer modal
  const openAddCustomer = () => {
    setEditingCustomer(null)
    setCustMobile("")
    setCustEmail("")
    setCustExpDate(addMonthsIso(todayIso(), 1))
    setCustBlocked(false)
    setFormError("")
    setShowAddCustomerModal(true)
  }

  // Bulk import: parse the pasted / uploaded sheet live
  const handleBulkTextChange = (text: string) => {
    setBulkText(text)
    setBulkParsed(text.trim() ? parseSheet(text) : null)
    setBulkMessage("")
  }

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const content = evt.target?.result as string
      if (!content) return
      const parsed = parseSheet(content)
      setBulkText(content)
      setBulkParsed(parsed)
      setShowBulkImportModal(true)
      setBulkMessage(`Loaded "${file.name}": ${parsed.rows.length} customers detected. Review below and click Import.`)
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const closeBulkImport = () => {
    setShowBulkImportModal(false)
    setBulkText("")
    setBulkParsed(null)
    setBulkMessage("")
  }

  const handleExecuteBulkImport = async () => {
    if (!bulkParsed?.rows.length) return
    setBulkBusy(true)
    setBulkMessage("Importing...")
    try {
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ rows: bulkParsed.rows }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setBulkMessage(data.message)
        setTimeout(() => {
          closeBulkImport()
          refresh()
        }, 2200)
      } else {
        setBulkMessage(data.message || "Failed to import rows")
      }
    } catch {
      setBulkMessage("Network error during import")
    } finally {
      setBulkBusy(false)
    }
  }

  // Export Customers to CSV
  const handleExportCsv = () => {
    const today = todayIso()
    const headers = "Netflix ID,Mobile,Expiry Date,Status,Total Updates\n"
    const rows = customers
      .map((c) => {
        const status = c.isBlocked ? "Blocked" : c.expiryDate && c.expiryDate < today ? "Expired" : "Active"
        return `${c.netflixEmail},${c.mobile},${c.expiryDate},${status},${c.totalUpdates}`
      })
      .join("\n")

    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `dreamlabs_customers_${today}.csv`
    link.click()
  }

  // Netflix Cookie Actions
  const handleSaveCookie = async (e: React.FormEvent) => {
    e.preventDefault()
    setCookieError("")

    try {
      const res = await fetch("/api/admin/cookies", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: editingCookie ? editingCookie.id : undefined,
          profileName: cookieProfileName || cookieEmail || "Netflix Account",
          accountLabel: cookieProfileName || cookieEmail || "Netflix Account",
          accountEmail: cookieEmail,
          cookiesRaw: cookieRawJson,
          userAgent: cookieUserAgent || (typeof navigator !== "undefined" ? navigator.userAgent : ""),
        }),
      })

      const data = await res.json()
      if (res.ok && data.ok) {
        setShowAddCookieModal(false)
        setEditingCookie(null)
        setCookieProfileName("")
        setCookieEmail("")
        setCookieRawJson("")
        setCookieUserAgent("")
        refresh()
      } else {
        setCookieError(data.message || "Failed to save cookies")
      }
    } catch {
      setCookieError("Network error")
    }
  }

  const openAddCookie = (email = "") => {
    setEditingCookie(null)
    setCookieProfileName("")
    setCookieEmail(email)
    setCookieRawJson("")
    setCookieUserAgent(typeof navigator !== "undefined" ? navigator.userAgent : "")
    setCookieError("")
    setShowAddCookieModal(true)
  }

  const handleDeleteCookie = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Netflix account from the vault?")) return
    try {
      await fetch(`/api/admin/cookies?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      })
      refresh()
    } catch {
      alert("Failed to delete account")
    }
  }

  // Live Test Cookies Button
  const handleTestCookie = async (id: string) => {
    setTestingCookieId(id)
    try {
      const res = await fetch("/api/admin/test-cookies", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ accountId: id }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        refresh()
      } else {
        alert(data.message || "Test failed")
      }
    } catch {
      alert("Network error testing cookies")
    } finally {
      setTestingCookieId(null)
    }
  }

  // Test All Cookies Button
  const handleTestAllCookies = async () => {
    setTestingAllCookies(true)
    try {
      const res = await fetch("/api/admin/test-all-cookies", {
        method: "POST",
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        refresh()
        alert(`Tested ${data.total} account(s): ${data.working} working.`)
      }
    } catch {
      alert("Error testing accounts")
    } finally {
      setTestingAllCookies(false)
    }
  }

  // Gmail inbox test for one Netflix ID
  const handleTestMailbox = async (email: string) => {
    setMailboxTests((m) => ({ ...m, [email]: { busy: true } }))
    try {
      const res = await fetch("/api/admin/test-mailbox", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      const result = data?.mailbox
      setMailboxTests((m) => ({
        ...m,
        [email]: { ok: Boolean(result?.ok), message: result?.message || data?.message || "No answer" },
      }))
    } catch {
      setMailboxTests((m) => ({ ...m, [email]: { ok: false, message: "Network error" } }))
    }
  }

  // Settings: general
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault()
    setGeneralMsg(null)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ general: generalForm }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setGeneralMsg({ ok: true, text: "Saved. The public site picks it up within a few seconds." })
        refresh()
      } else {
        setGeneralMsg({ ok: false, text: data.message || "Failed to save" })
      }
    } catch {
      setGeneralMsg({ ok: false, text: "Network error" })
    }
  }

  // Settings: plans
  const handleSavePlans = async (e: React.FormEvent) => {
    e.preventDefault()
    setPlansMsg(null)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          plans: planRows.map((r) => ({ months: Number(r.months), label: r.label, price: Number(r.price), enabled: r.enabled })),
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setPlansMsg({ ok: true, text: "Plans saved. Customers see them within a few seconds." })
        refresh()
      } else {
        setPlansMsg({ ok: false, text: data.message || "Failed to save plans" })
      }
    } catch {
      setPlansMsg({ ok: false, text: "Network error" })
    }
  }

  // Settings: Gmail inboxes
  const resetMailboxForm = () => {
    setMbxEditingId(null)
    setMbxUser("")
    setMbxPass("")
    setMbxLabel("")
  }

  const handleSaveMailbox = async (e: React.FormEvent) => {
    e.preventDefault()
    setMbxMsg(null)
    setMbxBusy("save")
    try {
      const res = await fetch("/api/admin/mailboxes", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ id: mbxEditingId || undefined, gmailUser: mbxUser, appPassword: mbxPass, label: mbxLabel }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setMbxMsg({ ok: data.test ? data.test.ok : true, text: data.message })
        resetMailboxForm()
        refresh()
      } else {
        setMbxMsg({ ok: false, text: data.message || "Failed to save" })
      }
    } catch {
      setMbxMsg({ ok: false, text: "Network error" })
    } finally {
      setMbxBusy(null)
    }
  }

  const handleTestMailbox2 = async (m: AdminMailbox) => {
    setMbxBusy(m.id || m.gmailUser)
    setMbxMsg(null)
    try {
      const res = await fetch("/api/admin/mailboxes", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(m.id ? { action: "test", id: m.id } : { action: "test_env", gmailUser: m.gmailUser }),
      })
      const data = await res.json()
      const t = data?.test
      setMbxMsg({ ok: Boolean(t?.ok), text: t ? `${m.gmailUser}: ${t.message}` : data.message || "Test failed" })
      refresh()
    } catch {
      setMbxMsg({ ok: false, text: "Network error" })
    } finally {
      setMbxBusy(null)
    }
  }

  const handleDeleteMailbox = async (m: AdminMailbox) => {
    if (!m.id) return
    if (!confirm(`Remove ${m.gmailUser}? Customers on Netflix IDs using this inbox will no longer get their household link.`)) return
    setMbxBusy(m.id)
    try {
      await fetch(`/api/admin/mailboxes?id=${m.id}`, { method: "DELETE", headers: getAuthHeaders() })
      refresh()
    } catch {
      setMbxMsg({ ok: false, text: "Network error" })
    } finally {
      setMbxBusy(null)
    }
  }

  const handleImportEnvMailboxes = async () => {
    setMbxBusy("import")
    setMbxMsg(null)
    try {
      const res = await fetch("/api/admin/mailboxes", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: "import_env" }),
      })
      const data = await res.json()
      setMbxMsg({ ok: res.ok && data.ok, text: data.message || "Failed" })
      refresh()
    } catch {
      setMbxMsg({ ok: false, text: "Network error" })
    } finally {
      setMbxBusy(null)
    }
  }

  // Netflix IDs tab: add the missing inbox
  const startAddInbox = (inbox: string) => {
    resetMailboxForm()
    setMbxUser(inbox)
    setMbxMsg(null)
    setSettingsSection("gmail")
    setActiveTab("settings")
  }

  // PayPur Gateway Key / Salt
  const handleSavePaypur = async (e: React.FormEvent) => {
    e.preventDefault()
    setPaypurMsg(null)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ paypur: { key: paypurKeyInput, salt: paypurSaltInput } }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setPaypur(data.paypur)
        setPaypurKeyInput("")
        setPaypurSaltInput("")
        setPaypurMsg({
          ok: true,
          text: data.paypur?.configured ? "Saved. Online purchase is ON." : "Saved. Add the other value to turn online purchase on.",
        })
      } else {
        setPaypurMsg({ ok: false, text: data.message || "Failed to save" })
      }
    } catch {
      setPaypurMsg({ ok: false, text: "Network error" })
    }
  }

  const handleClearPaypur = async () => {
    if (!confirm("Remove the saved PayPur key and salt? Customers will no longer be able to pay online.")) return
    setPaypurMsg(null)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ paypur: { clear: true } }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setPaypur(data.paypur)
        setPaypurMsg({ ok: true, text: "Keys removed. Online purchase is OFF." })
      } else {
        setPaypurMsg({ ok: false, text: data.message || "Failed to remove" })
      }
    } catch {
      setPaypurMsg({ ok: false, text: "Network error" })
    }
  }

  // Orders
  const handleOrderAction = async (o: Order, action: "refresh" | "mark_paid") => {
    if (action === "mark_paid" && !confirm(`Mark order ${o.orderId} (₹${o.amount}) as paid? Only do this after you saw the payment in PayPur.`)) return
    setOrderBusy(o.orderId)
    setOrderMsg("")
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ orderId: o.orderId, action }),
      })
      const data = await res.json()
      setOrderMsg(data.message || (res.ok ? "Done" : "Failed"))
      if (res.ok && data.ok) refresh()
    } catch {
      setOrderMsg("Network error")
    } finally {
      setOrderBusy(null)
    }
  }

  // A paid order: open the customer form ready to activate (new customer, or extend an existing one).
  const activateFromOrder = (o: Order) => {
    const months = o.planMonths ?? settings?.plans.find((pl) => pl.id === o.planId)?.months ?? 1
    const existing = customers.find((c) => c.mobile === o.mobile)
    const base = existing?.expiryDate && existing.expiryDate > todayIso() ? existing.expiryDate : todayIso()
    setEditingCustomer(existing || null)
    setCustMobile(o.mobile)
    setCustEmail(existing?.netflixEmail || "")
    setCustExpDate(addMonthsIso(base, months))
    setCustBlocked(existing?.isBlocked ?? false)
    setFormError("")
    setActiveTab("customers")
    setShowAddCustomerModal(true)
  }

  // Database Backup / Export JSON
  const handleDownloadBackup = () => {
    const fullBackup = {
      customers,
      netflixCookies,
      settings,
      activationsLog,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `dreamlabs_netflix_database_${todayIso()}.json`
    a.click()
  }

  // Database Restore
  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string)
        if (!parsed.customers || !Array.isArray(parsed.customers)) {
          alert("Invalid backup file format")
          return
        }
        const res = await fetch("/api/admin/data", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ restoreData: parsed }),
        })
        const data = await res.json()
        if (res.ok && data.ok) {
          alert(data.message || "Database successfully restored!")
          refresh()
        } else {
          alert(data.message || "Failed to restore database")
        }
      } catch {
        alert("Could not parse JSON backup file")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  // IF NOT AUTHENTICATED -> SHOW LOGIN GATE
  if (!token) {
    return (
      <div className="min-h-screen bg-netflix-dark flex items-center justify-center p-4 relative font-sans">
        <div className="absolute inset-0 bg-gradient-to-br from-netflix-dark via-netflix-darker to-black opacity-80" />
        <Card className="relative z-10 w-full max-w-sm bg-netflix-card border-netflix-border p-6 rounded-xl shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-netflix-red/20 rounded-full flex items-center justify-center mx-auto text-netflix-red">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white">Admin Console</h1>
            <p className="text-netflix-muted text-xs">Enter your administrator passcode</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Passcode"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="bg-netflix-input border-netflix-border text-white placeholder:text-netflix-muted h-12 text-center text-lg tracking-widest"
                autoFocus
              />
              {loginError && <p className="text-red-500 text-xs text-center">{loginError}</p>}
            </div>

            <Button
              type="submit"
              className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-11 rounded-lg"
            >
              Sign In
            </Button>
          </form>
        </Card>
      </div>
    )
  }

  const today = todayIso()
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: <Activity className="w-3.5 h-3.5" /> },
    { id: "customers", label: `Customers (${customers.length})`, icon: <Users className="w-3.5 h-3.5" /> },
    { id: "orders", label: `Orders (${orders.length})`, icon: <ShoppingCart className="w-3.5 h-3.5" /> },
    { id: "ids", label: `Netflix IDs (${netflixIds.length})`, icon: <Mail className="w-3.5 h-3.5" /> },
    { id: "cookies", label: `Cookie Vault (${netflixCookies.length})`, icon: <Cookie className="w-3.5 h-3.5" /> },
    { id: "logs", label: "Activity Logs", icon: <Tv className="w-3.5 h-3.5" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-3.5 h-3.5" /> },
  ] as const

  return (
    <div className="min-h-screen bg-netflix-dark text-netflix-light flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-netflix-border bg-netflix-card/60 backdrop-blur sticky top-0 z-30 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-netflix-red flex items-center justify-center font-bold text-white text-base">
            D
          </div>
          <div>
            <h1 className="font-bold text-white text-base leading-tight">{settings?.companyName || DEFAULT_BRAND.companyName}</h1>
            <p className="text-netflix-muted text-[11px]">Netflix Customer, Household & TV Code Admin Portal</p>
          </div>
        </div>

        {/* Tab switcher */}
        <nav className="flex items-center gap-1 bg-netflix-dark/80 p-1 rounded-xl border border-netflix-border flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === t.id ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {storageInfo?.isPersistent ? (
            <div
              className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
              title={storageInfo.details || "Connected to persistent database"}
            >
              <Database className="w-3.5 h-3.5" />
              <span>{storageInfo.label || "Supabase (permanent)"}</span>
            </div>
          ) : (
            <div
              className="bg-red-500/15 text-red-300 border border-red-500/40 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
              title={storageInfo?.details || storageError || "Storage status unknown"}
            >
              <Database className="w-3.5 h-3.5" />
              <span>{storageInfo ? "Storage error" : "Checking storage..."}</span>
            </div>
          )}

          <Button
            onClick={() => window.open("/", "_blank")}
            variant="outline"
            className="border-netflix-border text-netflix-gray hover:text-white text-xs h-8 px-2.5 bg-transparent cursor-pointer"
          >
            Open Public Site
          </Button>
          <Button
            onClick={handleLogout}
            variant="ghost"
            className="text-netflix-muted hover:text-red-400 text-xs h-8 px-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4 mr-1" /> Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-24 text-netflix-muted gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-netflix-red" />
            <span>Loading admin database...</span>
          </div>
        )}

        {!loading && (
          <>
            {storageError && (
              <div className="mb-4 bg-red-950/50 border border-red-700/60 rounded-xl p-4 text-sm text-red-200 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-300">Storage error: data could not be loaded from Supabase</p>
                  <p className="text-xs text-red-200/80 font-mono break-all">{storageError}</p>
                  <p className="text-xs text-red-200/70">
                    Nothing is shown below until the database is reachable, so no data is lost or overwritten. Check the Supabase
                    environment variables in Vercel and that the Dream Labs migration (dl_* tables) has been run.
                  </p>
                </div>
              </div>
            )}

            {/* 1. DASHBOARD TAB */}
            {!storageError && activeTab === "dashboard" && (
              <div className="space-y-6 animate-fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Total Subscribers</p>
                    <p className="text-3xl font-bold text-white">{metrics?.totalSubscribers ?? customers.length}</p>
                    <p className="text-green-400 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {metrics?.activeSubscribers ?? 0} active subscriptions
                    </p>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Expired Subscribers</p>
                    <p className="text-3xl font-bold text-yellow-400">{metrics?.expiredSubscribers ?? 0}</p>
                    <p className="text-netflix-muted text-xs">Re-import the sheet to renew them</p>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Updates This Month</p>
                    <p className="text-3xl font-bold text-netflix-red">{metrics?.activationsMonth ?? 0}</p>
                    <p className="text-netflix-muted text-xs">Today: {metrics?.activationsToday ?? 0} successful</p>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Netflix IDs</p>
                    <p className="text-3xl font-bold text-white">{metrics?.netflixIds ?? netflixIds.length}</p>
                    <p
                      className={`text-xs flex items-center gap-1 ${
                        metrics?.idsMissingGmail ? "text-amber-300" : "text-green-400"
                      }`}
                    >
                      <Shield className="w-3 h-3" />
                      {metrics?.idsMissingGmail
                        ? `${metrics.idsMissingGmail} without a Gmail login`
                        : "Gmail set up for every ID"}
                    </p>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="bg-netflix-card border-netflix-border p-5 rounded-xl space-y-3">
                    <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                      <Users className="w-4 h-4 text-netflix-red" /> Customer Management Quick Actions
                    </h3>
                    <p className="text-netflix-muted text-xs">
                      Add a customer or paste your sheet (Netflix ID, mobile number, expiry). A number that already exists is updated
                      to the new Netflix ID and expiry.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={openAddCustomer}
                        className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Customer
                      </Button>
                      <Button
                        onClick={() => setShowBulkImportModal(true)}
                        variant="outline"
                        className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import from Sheet
                      </Button>
                    </div>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-5 rounded-xl space-y-3">
                    <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                      <Cookie className="w-4 h-4 text-netflix-red" /> Netflix Session Health Check
                    </h3>
                    <p className="text-netflix-muted text-xs">
                      Verify that the cookies used for TV login are valid ({metrics?.activeCookies ?? 0} of{" "}
                      {metrics?.totalCookieAccounts ?? netflixCookies.length} accounts live).
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleTestAllCookies}
                        disabled={testingAllCookies || netflixCookies.length === 0}
                        className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                      >
                        {testingAllCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                        Test All Netflix Accounts
                      </Button>
                      <Button
                        onClick={() => openAddCookie()}
                        variant="outline"
                        className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Account Cookies
                      </Button>
                    </div>
                  </Card>
                </div>

                <Card className="bg-netflix-card border-netflix-border p-5 rounded-xl space-y-3">
                  <h3 className="font-semibold text-white text-sm">Recent TV Logins & Updates</h3>
                  {activationsLog.length === 0 ? (
                    <p className="text-netflix-muted text-xs py-4 text-center">No login attempts recorded yet</p>
                  ) : (
                    <div className="divide-y divide-netflix-border/50">
                      {activationsLog.slice(0, 5).map((l) => (
                        <div key={l.id} className="py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white">+91 {l.mobile}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                                l.action === "tv_login" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                              }`}
                            >
                              {l.action === "tv_login" ? "TV Login" : "Household Update"}
                            </span>
                            {l.code && <span className="font-mono text-netflix-muted">Code: {l.code}</span>}
                          </div>
                          <span className="text-netflix-muted">{new Date(l.timestamp).toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* 2. CUSTOMERS TAB */}
            {!storageError && activeTab === "customers" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 max-w-xl flex-wrap">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search className="w-4 h-4 text-netflix-muted absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        placeholder="Search by mobile or Netflix ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-netflix-input border-netflix-border pl-9 h-10 text-xs text-white"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-netflix-card p-1 rounded-lg border border-netflix-border text-xs">
                      {(["all", "active", "expired", "cooldown", "blocked"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setCustomerFilter(f)}
                          className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize cursor-pointer transition-colors ${
                            customerFilter === f ? "bg-netflix-red text-white" : "text-netflix-muted hover:text-white"
                          }`}
                        >
                          {f === "cooldown" ? "limit reached" : f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      onClick={openAddCustomer}
                      className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Customer
                    </Button>
                    <label className="border border-netflix-red/60 bg-netflix-red/10 hover:bg-netflix-red hover:text-white text-netflix-red text-xs h-10 px-3 rounded-md inline-flex items-center gap-1.5 cursor-pointer transition-colors font-medium">
                      <Upload className="w-3.5 h-3.5" /> Upload CSV
                      <input type="file" accept=".csv,.txt,.tsv" onChange={handleCsvFileUpload} className="hidden" />
                    </label>
                    <Button
                      onClick={() => setShowBulkImportModal(true)}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-10 bg-transparent cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Paste Sheet
                    </Button>
                    <Button
                      onClick={handleExportCsv}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-10 bg-transparent cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                    </Button>
                  </div>
                </div>

                <Card className="bg-netflix-card border-netflix-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                        <tr>
                          <th className="py-3 px-4">Customer Mobile</th>
                          <th className="py-3 px-4">Netflix ID</th>
                          <th className="py-3 px-4">Expiry Date</th>
                          <th className="py-3 px-4">TV Cookies</th>
                          <th className="py-3 px-4">Usage Counter</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                        {filteredCustomers.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-netflix-muted">
                              No customer records found
                            </td>
                          </tr>
                        ) : (
                          filteredCustomers.map((c) => {
                            const isExpired = c.expiryDate && c.expiryDate < today
                            const cooldown = getCustomerCooldownInfo(c)

                            return (
                              <tr key={c.id} className="hover:bg-netflix-input/30 transition-colors">
                                <td className="py-3 px-4 font-mono font-medium text-white">+91 {c.mobile}</td>
                                <td className="py-3 px-4 font-mono text-[11px] text-netflix-light break-all">{c.netflixEmail}</td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-1.5">
                                    <span className={isExpired ? "text-red-400 font-semibold" : "text-white"}>
                                      {formatDisplayDate(c.expiryDate)}
                                    </span>
                                    {isExpired ? (
                                      <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-medium">
                                        Expired
                                      </span>
                                    ) : (
                                      <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded font-medium">
                                        Active
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusTone(c.linkedAccountStatus)}`}>
                                    {statusLabel(c.linkedAccountStatus)}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5 font-mono">
                                      <span className={cooldown.isMonthlyMax ? "text-yellow-400 font-bold" : "text-white"}>
                                        {cooldown.monthUsed}/{cooldown.max} TV
                                      </span>
                                      <span className="text-netflix-muted text-[10px]">(Total: {c.totalUpdates || 0})</span>
                                    </div>
                                    <div className="w-16 h-1.5 bg-netflix-dark rounded-full overflow-hidden">
                                      <div
                                        className={`h-full ${cooldown.isMonthlyMax ? "bg-yellow-500" : "bg-netflix-red"}`}
                                        style={{ width: `${Math.min(100, (cooldown.monthUsed / cooldown.max) * 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  {c.isBlocked ? (
                                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">
                                      Blocked
                                    </span>
                                  ) : isExpired ? (
                                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">
                                      Expired
                                    </span>
                                  ) : cooldown.isMonthlyMax ? (
                                    <span className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded text-[11px] font-medium">
                                      TV limit used this month
                                    </span>
                                  ) : (
                                    <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 w-fit">
                                      <CheckCircle2 className="w-3 h-3" /> Ready
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {cooldown.isMonthlyMax && (
                                      <Button
                                        onClick={() => handleResetCooldown(c.id)}
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] px-2 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 cursor-pointer"
                                        title="Give this customer a full TV login allowance again from now"
                                      >
                                        Reset Limit
                                      </Button>
                                    )}

                                    <button
                                      onClick={() => setSelectedCustomerHistory(c)}
                                      className="text-netflix-muted hover:text-white p-1 cursor-pointer"
                                      title="View usage history"
                                    >
                                      <Activity className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => handleToggleBlock(c)}
                                      className={`p-1 cursor-pointer ${c.isBlocked ? "text-red-400" : "text-netflix-muted hover:text-white"}`}
                                      title={c.isBlocked ? "Unblock access" : "Block access"}
                                    >
                                      <Shield className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => openEditCustomer(c)}
                                      className="text-netflix-muted hover:text-white p-1 cursor-pointer"
                                      title="Edit customer"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteCustomer(c.id)}
                                      className="text-netflix-muted hover:text-red-400 p-1 cursor-pointer"
                                      title="Delete customer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* ORDERS TAB */}
            {!storageError && activeTab === "orders" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-base font-bold text-white">Online Orders</h2>
                    <p className="text-netflix-muted text-xs max-w-2xl">
                      Purchases made on the Buy Plan tab. After paying, the customer sends the order details on WhatsApp: use{" "}
                      <span className="text-netflix-light">Activate</span> to give them their Netflix ID and expiry.
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-netflix-muted">
                      Paid:{" "}
                      <span className="text-green-400 font-semibold">{orders.filter((o) => o.status === "paid").length}</span>
                    </span>
                    <span className="text-netflix-muted">
                      Revenue:{" "}
                      <span className="text-white font-semibold">
                        ₹{displayPrice(orders.filter((o) => o.status === "paid").reduce((n, o) => n + o.amount, 0))}
                      </span>
                    </span>
                  </div>
                </div>

                {!paypur?.configured && (
                  <div className="bg-amber-950/40 border border-amber-700/50 rounded-xl p-3 text-xs text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p>
                      Online purchase is OFF. Save the PayPur Gateway Key and Gateway Salt in <b>Settings</b> to turn it on.
                    </p>
                  </div>
                )}
                {ordersError && (
                  <div className="bg-red-950/50 border border-red-700/60 rounded-xl p-3 text-xs text-red-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p>
                      Orders could not be loaded: <span className="font-mono">{ordersError}</span>. Run{" "}
                      <span className="font-mono">03_dreamlabs_payments.sql</span> in the Supabase SQL Editor.
                    </p>
                  </div>
                )}
                {orderMsg && <p className="text-xs text-yellow-400">{orderMsg}</p>}

                <Card className="bg-netflix-card border-netflix-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                        <tr>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Customer</th>
                          <th className="py-3 px-4">Plan</th>
                          <th className="py-3 px-4">Order / Txn</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                        {orders.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-netflix-muted">
                              No orders yet
                            </td>
                          </tr>
                        ) : (
                          orders.map((o) => (
                            <tr key={o.orderId} className="hover:bg-netflix-input/30 align-top">
                              <td className="py-3 px-4 text-netflix-muted whitespace-nowrap">
                                {new Date(o.createdAt).toLocaleString("en-IN")}
                              </td>
                              <td className="py-3 px-4">
                                <p className="font-mono font-medium text-white">+91 {o.mobile}</p>
                                <p className="text-netflix-muted text-[11px]">{o.customerName}</p>
                                <p className="text-netflix-muted text-[11px] break-all">{o.customerEmail}</p>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <p className="text-white font-medium">{o.planLabel}</p>
                                <p className="text-netflix-muted text-[11px]">₹{displayPrice(o.amount)}</p>
                              </td>
                              <td className="py-3 px-4 font-mono text-[11px]">
                                <p className="text-netflix-light break-all">{o.orderId}</p>
                                <p className="text-netflix-muted break-all">{o.txnId || "no txn id yet"}</p>
                              </td>
                              <td className="py-3 px-4 max-w-[220px]">
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                    o.status === "paid"
                                      ? "bg-green-500/20 text-green-400"
                                      : o.status === "failed"
                                        ? "bg-red-500/20 text-red-400"
                                        : "bg-yellow-500/20 text-yellow-400"
                                  }`}
                                >
                                  {o.status === "paid" ? "Paid" : o.status === "failed" ? "Failed" : "Pending"}
                                </span>
                                {o.gatewayStatus && <p className="text-netflix-muted text-[10px] mt-1">PayPur: {o.gatewayStatus}</p>}
                                {o.notes && <p className="text-netflix-muted text-[10px] break-words">{o.notes}</p>}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                  {o.status === "paid" ? (
                                    <Button
                                      onClick={() => activateFromOrder(o)}
                                      size="sm"
                                      className="h-7 text-[11px] px-2 bg-netflix-red hover:bg-netflix-red-hover text-white cursor-pointer"
                                    >
                                      Activate
                                    </Button>
                                  ) : (
                                    <>
                                      <Button
                                        onClick={() => handleOrderAction(o, "refresh")}
                                        disabled={orderBusy === o.orderId}
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] px-2 border-netflix-border text-netflix-light hover:text-white bg-transparent cursor-pointer"
                                        title="Ask PayPur for this transaction's status"
                                      >
                                        {orderBusy === o.orderId ? <Loader2 className="w-3 h-3 animate-spin" /> : "Check status"}
                                      </Button>
                                      <Button
                                        onClick={() => handleOrderAction(o, "mark_paid")}
                                        disabled={orderBusy === o.orderId}
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] px-2 border-netflix-border text-netflix-muted hover:text-green-400 bg-transparent cursor-pointer"
                                        title="Use only after you saw the payment in PayPur"
                                      >
                                        Mark paid
                                      </Button>
                                    </>
                                  )}
                                  <a
                                    href={`https://wa.me/91${o.mobile}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="h-7 px-2 inline-flex items-center rounded-md border border-netflix-border text-[11px] text-netflix-light hover:text-white"
                                  >
                                    WhatsApp
                                  </a>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* 3. NETFLIX IDS TAB */}
            {!storageError && activeTab === "ids" && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <h2 className="text-base font-bold text-white">Netflix IDs</h2>
                  <p className="text-netflix-muted text-xs max-w-3xl">
                    Every customer is tied to the Netflix ID on their row. The household link is read from that ID&apos;s Gmail inbox
                    (add inboxes in Settings &gt; Gmail Inboxes), and TV login uses the vault cookies saved with the same email.
                  </p>
                </div>

                <Card className="bg-netflix-card border-netflix-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                        <tr>
                          <th className="py-3 px-4">Netflix ID</th>
                          <th className="py-3 px-4">Customers</th>
                          <th className="py-3 px-4">Gmail inbox</th>
                          <th className="py-3 px-4">TV cookies</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                        {netflixIds.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-netflix-muted">
                              No Netflix IDs yet. Import your customer sheet first.
                            </td>
                          </tr>
                        ) : (
                          netflixIds.map((n) => {
                            const test = mailboxTests[n.email]
                            return (
                              <tr key={n.email} className="hover:bg-netflix-input/30">
                                <td className="py-3 px-4 font-mono text-[11px] text-white break-all">{n.email}</td>
                                <td className="py-3 px-4">
                                  <span className="text-white font-medium">{n.customers}</span>
                                  <span className="text-netflix-muted"> ({n.activeCustomers} active)</span>
                                </td>
                                <td className="py-3 px-4">
                                  {n.gmailConfigured ? (
                                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[11px] font-semibold">
                                      Configured
                                    </span>
                                  ) : (
                                    <span
                                      className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold"
                                      title={`Add ${n.inbox} and its Google app password in Settings > Gmail Inboxes`}
                                    >
                                      Missing: {n.inbox}
                                    </span>
                                  )}
                                  {test && !test.busy && (
                                    <p className={`text-[11px] mt-1 ${test.ok ? "text-emerald-400" : "text-red-300"}`}>{test.message}</p>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusTone(n.vaultStatus)}`}>
                                    {statusLabel(n.vaultStatus)}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      onClick={() => handleTestMailbox(n.email)}
                                      disabled={test?.busy || !n.gmailConfigured}
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] px-2 border-netflix-border text-netflix-light hover:text-white bg-transparent cursor-pointer"
                                      title="Log in to the Gmail inbox for this ID"
                                    >
                                      {test?.busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Mail className="w-3 h-3 mr-1" />}
                                      Test Gmail
                                    </Button>
                                    {!n.gmailConfigured && (
                                      <Button
                                        onClick={() => startAddInbox(n.inbox)}
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] px-2 border-netflix-border text-netflix-light hover:text-white bg-transparent cursor-pointer"
                                      >
                                        <Plus className="w-3 h-3 mr-1" /> Gmail
                                      </Button>
                                    )}
                                    {!n.vaultAccountId && (
                                      <Button
                                        onClick={() => {
                                          openAddCookie(n.email)
                                          setActiveTab("cookies")
                                        }}
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] px-2 border-netflix-border text-netflix-light hover:text-white bg-transparent cursor-pointer"
                                      >
                                        <Plus className="w-3 h-3 mr-1" /> Cookies
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* 4. COOKIE VAULT TAB */}
            {!storageError && activeTab === "cookies" && (
              <div className="space-y-4 animate-fade-in">
                <div className="bg-netflix-card border border-netflix-border rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    {storageInfo?.isPersistent ? (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5" /> Storage: {storageInfo.label}
                      </span>
                    ) : (
                      <span
                        className="bg-red-500/15 text-red-300 border border-red-500/40 px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5"
                        title={storageInfo?.details || "Storage status unknown"}
                      >
                        <Database className="w-3.5 h-3.5" /> Storage: {storageInfo ? "error" : "checking..."}
                      </span>
                    )}
                    {storageInfo?.details && !storageInfo.isPersistent && (
                      <span className="text-[11px] text-red-300/80 font-mono">({storageInfo.details})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-netflix-muted font-mono text-[11px]">
                    <Clock className="w-3.5 h-3.5 text-netflix-light" />
                    <span>Auto-Keepalive: every 6h (GitHub Actions) + daily Vercel cron</span>
                  </div>
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-base font-bold text-white">Netflix Accounts & Session Vault</h2>
                    <p className="text-netflix-muted text-xs">
                      Cookies are matched to customers by Netflix ID, bound to the browser User-Agent and refreshed automatically.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleTestAllCookies}
                      disabled={testingAllCookies || netflixCookies.length === 0}
                      className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                    >
                      {testingAllCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                      Test & Keep Alive All
                    </Button>
                    <Button
                      onClick={() => openAddCookie()}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Account Cookies
                    </Button>
                  </div>
                </div>

                {netflixCookies.length === 0 && (
                  <Card className="bg-netflix-card border-netflix-border p-8 rounded-xl text-center text-netflix-muted text-xs">
                    No accounts in the vault yet. Add the cookies for a Netflix ID to enable TV login for its customers.
                  </Card>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {netflixCookies.map((acc) => {
                    const isTesting = testingCookieId === acc.id
                    const linkedUsersCount = customers.filter((c) => c.linkedAccountId === acc.id).length
                    const isNeedsReimport = acc.status === "needs_reimport"
                    const isExpired = acc.status === "expired" || acc.lastResult === "expired"
                    const isExpiringSoon = acc.status === "expiring_soon"
                    const isUnverified = acc.status === "unverified"
                    const isLive = acc.status === "live"

                    return (
                      <Card
                        key={acc.id}
                        className={`bg-netflix-card border p-5 rounded-xl space-y-4 ${
                          isNeedsReimport
                            ? "border-red-500/70 shadow-lg shadow-red-950/20"
                            : isExpiringSoon
                              ? "border-amber-500/50"
                              : "border-netflix-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-bold text-white text-base truncate">{acc.accountLabel || acc.profileName}</h3>
                            <p className="text-netflix-muted text-xs font-mono break-all">{acc.accountEmail || "No Netflix ID"}</p>
                          </div>
                          {isLive ? (
                            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded font-semibold flex items-center gap-1 shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Live
                            </span>
                          ) : isExpiringSoon ? (
                            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded font-semibold flex items-center gap-1 shrink-0">
                              <Clock className="w-3.5 h-3.5" /> Expiring Soon
                            </span>
                          ) : isNeedsReimport ? (
                            <span className="bg-red-500/25 text-red-400 border border-red-500/50 text-xs px-2.5 py-0.5 rounded font-bold flex items-center gap-1 animate-pulse shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5" /> Needs Re-import
                            </span>
                          ) : isExpired ? (
                            <span className="bg-red-950/40 text-red-300 border border-red-800/40 text-xs px-2.5 py-0.5 rounded font-semibold flex items-center gap-1 shrink-0">
                              <XCircle className="w-3.5 h-3.5" /> Expired
                            </span>
                          ) : isUnverified ? (
                            <span
                              className="bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs px-2.5 py-0.5 rounded font-semibold shrink-0"
                              title="Netflix could not be reached on the last check"
                            >
                              Unverified
                            </span>
                          ) : (
                            <span className="bg-yellow-500/20 text-yellow-400 text-xs px-2.5 py-0.5 rounded font-semibold shrink-0">
                              Untested
                            </span>
                          )}
                        </div>

                        {isNeedsReimport && (
                          <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-2.5 text-xs text-red-200 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-red-300">Session Invalidated by Netflix</p>
                              <p className="text-[11px] text-red-300/80">
                                Netflix redirected to login. Automatic keepalive cannot refresh this session. Please export fresh
                                cookies and edit this account.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="bg-netflix-dark/60 border border-netflix-border/50 rounded-lg p-3 text-xs space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-netflix-muted">Cookies Count:</span>
                            <span className="text-white font-mono">{acc.cookies?.length || 0} cookies</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-netflix-muted">Linked Customers:</span>
                            <span className="text-white font-mono">{linkedUsersCount} users</span>
                          </div>
                          {acc.earliestExpiryIso && (
                            <div className="flex justify-between">
                              <span className="text-netflix-muted">Token Expiry:</span>
                              <span
                                className={`font-mono ${
                                  isExpiringSoon ? "text-amber-300" : isExpired ? "text-red-400" : "text-netflix-light"
                                }`}
                              >
                                {new Date(acc.earliestExpiryIso).toLocaleDateString("en-IN")}
                              </span>
                            </div>
                          )}
                          {acc.lastCheckedAt && (
                            <div className="flex justify-between">
                              <span className="text-netflix-muted">Last Checked:</span>
                              <span className="text-netflix-light">{new Date(acc.lastCheckedAt).toLocaleString("en-IN")}</span>
                            </div>
                          )}
                          {acc.lastRefreshedAt && (
                            <div className="flex justify-between">
                              <span className="text-netflix-muted">Last Refreshed:</span>
                              <span className="text-emerald-400 font-medium">
                                {new Date(acc.lastRefreshedAt).toLocaleString("en-IN")}
                              </span>
                            </div>
                          )}
                          {acc.userAgent && (
                            <div className="flex justify-between items-center pt-1 border-t border-netflix-border/30 text-[11px]">
                              <span className="text-netflix-muted">Device:</span>
                              <span className="text-netflix-light font-mono truncate max-w-[170px]" title={acc.userAgent}>
                                {acc.userAgent.includes("Mac")
                                  ? "Chrome (macOS)"
                                  : acc.userAgent.includes("Windows")
                                    ? "Chrome (Windows)"
                                    : "Desktop Browser"}
                              </span>
                            </div>
                          )}
                          {acc.lastDetail && (
                            <p className="text-[11px] text-netflix-muted pt-1 border-t border-netflix-border/40">{acc.lastDetail}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            onClick={() => handleTestCookie(acc.id)}
                            disabled={isTesting}
                            className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                          >
                            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                            Test & Keep Alive
                          </Button>
                          <Button
                            onClick={() => {
                              setEditingCookie(acc)
                              setCookieProfileName(acc.profileName)
                              setCookieEmail(acc.accountEmail || "")
                              setCookieRawJson(JSON.stringify(acc.cookies, null, 2))
                              setCookieUserAgent(acc.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : ""))
                              setCookieError("")
                              setShowAddCookieModal(true)
                            }}
                            variant="outline"
                            className="border-netflix-border text-netflix-light hover:text-white text-xs h-9 bg-transparent cursor-pointer"
                            title="Edit account cookies"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            onClick={() => handleDeleteCookie(acc.id)}
                            variant="outline"
                            className="border-netflix-border text-netflix-muted hover:text-red-400 text-xs h-9 bg-transparent cursor-pointer"
                            title="Delete account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 5. ACTIVITY LOGS TAB */}
            {!storageError && activeTab === "logs" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Live Activity & Activation Log</h2>
                  <span className="text-netflix-muted text-xs">{activationsLog.length} total entries</span>
                </div>

                <Card className="bg-netflix-card border-netflix-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                        <tr>
                          <th className="py-3 px-4">Timestamp</th>
                          <th className="py-3 px-4">Mobile</th>
                          <th className="py-3 px-4">Netflix ID</th>
                          <th className="py-3 px-4">Action</th>
                          <th className="py-3 px-4">TV Code</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Client IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                        {activationsLog.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-netflix-muted">
                              No logs recorded yet
                            </td>
                          </tr>
                        ) : (
                          activationsLog.map((l) => (
                            <tr key={l.id} className="hover:bg-netflix-input/30">
                              <td className="py-3 px-4 text-netflix-muted whitespace-nowrap">
                                {new Date(l.timestamp).toLocaleString("en-IN")}
                              </td>
                              <td className="py-3 px-4 font-mono font-medium text-white">+91 {l.mobile}</td>
                              <td className="py-3 px-4 font-mono text-[11px] text-netflix-muted break-all">{l.netflixEmail || "—"}</td>
                              <td className="py-3 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    l.action === "tv_login" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                                  }`}
                                >
                                  {l.action === "tv_login" ? "TV Login" : "Household Update"}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono">{l.code || "—"}</td>
                              <td className="py-3 px-4 max-w-xs">
                                <span
                                  className={`font-medium ${
                                    l.status === "success"
                                      ? "text-green-400"
                                      : l.status === "rate_limited"
                                        ? "text-yellow-400"
                                        : "text-red-400"
                                  }`}
                                >
                                  {l.status === "success"
                                    ? "Success"
                                    : l.status === "rate_limited"
                                      ? "Limit reached"
                                      : l.status === "blocked"
                                        ? "Blocked"
                                        : "Failed"}
                                </span>
                                {l.notes && <p className="text-netflix-muted text-[10px] mt-0.5 break-words">{l.notes}</p>}
                              </td>
                              <td className="py-3 px-4 font-mono text-netflix-muted">{l.ip || "unknown"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* 6. SETTINGS TAB */}
            {!storageError && activeTab === "settings" && (
              <div className="space-y-6 max-w-3xl animate-fade-in">
                <div className="flex items-center gap-1 bg-netflix-card p-1 rounded-xl border border-netflix-border w-fit flex-wrap">
                  {(
                    [
                      ["general", "General"],
                      ["gmail", `Gmail Inboxes (${mailboxes.length})`],
                      ["payments", "Plans & Payments"],
                      ["backup", "Backup"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setSettingsSection(id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        settingsSection === id ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {settingsSection === "general" && (
                  <>
                    <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-5">
                      <div>
                        <h2 className="text-base font-bold text-white">General Settings</h2>
                        <p className="text-netflix-muted text-xs">Saved in the database. No redeploy needed: the public site picks changes up within a few seconds.</p>
                      </div>

                      <form onSubmit={handleSaveGeneral} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-netflix-light block">Company name</label>
                            <Input
                              value={generalForm.companyName}
                              onChange={(e) => setGeneralForm({ ...generalForm, companyName: e.target.value })}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              maxLength={60}
                              required
                            />
                            <p className="text-[11px] text-netflix-muted">Shown on the site and in WhatsApp messages.</p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-netflix-light block">Support WhatsApp number</label>
                            <Input
                              value={generalForm.supportWhatsapp}
                              onChange={(e) => setGeneralForm({ ...generalForm, supportWhatsapp: e.target.value })}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                              placeholder="91 99914 83279"
                              required
                            />
                            <p className="text-[11px] text-netflix-muted">
                              With country code. Customers reach it from every error screen
                              {settings?.supportWhatsapp ? <> (now {formatWhatsapp(settings.supportWhatsapp)})</> : null}.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-netflix-light block">TV logins per customer per calendar month</label>
                            <Input
                              type="number"
                              value={generalForm.maxUpdatesPerMonth}
                              onChange={(e) => setGeneralForm({ ...generalForm, maxUpdatesPerMonth: e.target.value })}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              min={1}
                              max={31}
                            />
                            <p className="text-[11px] text-netflix-muted">Household updates are unlimited.</p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-netflix-light block">Look for Netflix&apos;s email in the last (minutes)</label>
                            <Input
                              type="number"
                              value={generalForm.householdLookbackMinutes}
                              onChange={(e) => setGeneralForm({ ...generalForm, householdLookbackMinutes: e.target.value })}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              min={5}
                              max={120}
                            />
                            <p className="text-[11px] text-netflix-muted">For the household link. 5 to 120, default 30.</p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-netflix-light block">Keep the activity log (days)</label>
                            <Input
                              type="number"
                              value={generalForm.logRetentionDays}
                              onChange={(e) => setGeneralForm({ ...generalForm, logRetentionDays: e.target.value })}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              min={31}
                              max={3650}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-netflix-light block">Site URL (optional)</label>
                            <Input
                              value={generalForm.siteUrl}
                              onChange={(e) => setGeneralForm({ ...generalForm, siteUrl: e.target.value })}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                              placeholder="https://your-domain.com"
                            />
                            <p className="text-[11px] text-netflix-muted">Used for PayPur&apos;s return URLs. Leave empty to use the address people visit.</p>
                          </div>
                        </div>

                        {generalMsg && <p className={`text-xs font-medium ${generalMsg.ok ? "text-green-400" : "text-red-400"}`}>{generalMsg.text}</p>}

                        <Button type="submit" className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                          Save Settings
                        </Button>
                      </form>
                    </Card>

                    <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                      <div>
                        <h2 className="text-base font-bold text-white">Still set in Vercel</h2>
                        <p className="text-netflix-muted text-xs leading-relaxed">
                          These are the only environment variables left. They cannot be edited here: the app needs them to reach the
                          database and to protect this login before it can read any setting.
                        </p>
                      </div>
                      <div className="divide-y divide-netflix-border/50 text-xs">
                        {[
                          {
                            name: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
                            ok: true,
                            note: "Set (this page is reading from the database).",
                          },
                          {
                            name: "ADMIN_PASSWORD",
                            ok: Boolean(envStatus?.adminPassword),
                            note: envStatus?.adminPassword ? "Set. Changing it signs out every admin session." : "Missing: nobody can sign in to this panel.",
                          },
                          {
                            name: "CRON_SECRET",
                            ok: Boolean(envStatus?.cronSecret),
                            note: envStatus?.cronSecret
                              ? "Set. Used by the keepalive cron."
                              : "Missing: the cookie keepalive cron cannot run. Add it in Vercel and as a GitHub Actions secret.",
                          },
                          {
                            name: "SETTINGS_ENCRYPTION_KEY (optional)",
                            ok: Boolean(envStatus?.encryptionKey),
                            optional: true,
                            note: envStatus?.encryptionKey
                              ? "Set: Gmail app passwords and PayPur keys saved from now on are stored encrypted."
                              : "Not set: Gmail app passwords and PayPur keys are stored as typed (protected by the database's service key). Set it in Vercel to encrypt them.",
                          },
                        ].map((row) => (
                          <div key={row.name} className="py-2.5 flex items-start gap-3">
                            <span
                              className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                                row.ok ? "bg-emerald-400" : (row as any).optional ? "bg-netflix-muted" : "bg-red-400"
                              }`}
                            />
                            <div>
                              <p className="font-mono text-netflix-light">{row.name}</p>
                              <p className="text-netflix-muted text-[11px]">{row.note}</p>
                            </div>
                          </div>
                        ))}
                        {Boolean(envStatus?.legacyGmailInboxes) && (
                          <div className="py-2.5 flex items-start gap-3">
                            <span className="mt-0.5 w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                            <div>
                              <p className="font-mono text-netflix-light">GMAIL_USER_n / GMAIL_APP_PASSWORD_n</p>
                              <p className="text-netflix-muted text-[11px]">
                                {envStatus?.legacyGmailInboxes} inbox(es) still come from Vercel. Copy them into the panel in the Gmail Inboxes
                                section, then delete these variables.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  </>
                )}

                {settingsSection === "gmail" && (
                  <>
                    <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="max-w-xl">
                          <h2 className="text-base font-bold text-white">Gmail Inboxes</h2>
                          <p className="text-netflix-muted text-xs leading-relaxed">
                            Netflix emails the household link to each customer&apos;s Netflix ID. Save the Gmail inbox that receives those
                            emails (the plain address, without a +tag) and a Google app password. Several Netflix IDs such as{" "}
                            <span className="font-mono">name+4@gmail.com</span> and <span className="font-mono">name+5@gmail.com</span> use the
                            one inbox <span className="font-mono">name@gmail.com</span>. Passwords are never shown again.
                          </p>
                        </div>
                      </div>

                      {mailboxesError && (
                        <div className="bg-red-950/50 border border-red-700/60 rounded-lg p-3 text-xs text-red-200">
                          Gmail inboxes could not be loaded: <span className="font-mono">{mailboxesError}</span>. Run{" "}
                          <span className="font-mono">04_dreamlabs_panel_settings.sql</span> in the Supabase SQL Editor.
                        </div>
                      )}

                      {Boolean(envStatus?.legacyGmailInboxes) && (
                        <div className="bg-amber-950/40 border border-amber-700/50 rounded-lg p-3 text-xs text-amber-200 flex items-center justify-between gap-3 flex-wrap">
                          <p>
                            {envStatus?.legacyGmailInboxes} inbox(es) are still set in Vercel. Copy them here, then delete{" "}
                            <span className="font-mono">GMAIL_USER_n</span> / <span className="font-mono">GMAIL_APP_PASSWORD_n</span> there.
                          </p>
                          <Button
                            onClick={handleImportEnvMailboxes}
                            disabled={mbxBusy === "import" || Boolean(mailboxesError)}
                            size="sm"
                            className="h-8 text-xs bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
                          >
                            {mbxBusy === "import" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Copy to panel
                          </Button>
                        </div>
                      )}

                      <div className="border border-netflix-border rounded-lg overflow-hidden">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                            <tr>
                              <th className="py-2.5 px-3">Gmail inbox</th>
                              <th className="py-2.5 px-3">Status</th>
                              <th className="py-2.5 px-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                            {mailboxes.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="py-6 text-center text-netflix-muted">
                                  No inboxes yet. Add one below.
                                </td>
                              </tr>
                            ) : (
                              mailboxes.map((m) => {
                                const busy = mbxBusy === (m.id || m.gmailUser)
                                return (
                                  <tr key={m.id || m.gmailUser} className="align-top">
                                    <td className="py-3 px-3">
                                      <p className="font-mono text-white break-all">{m.gmailUser}</p>
                                      <p className="text-netflix-muted text-[11px]">
                                        {m.source === "env" ? "From Vercel (copy it to the panel)" : m.label || "Saved in the panel"}
                                      </p>
                                    </td>
                                    <td className="py-3 px-3 max-w-[260px]">
                                      {m.secretError ? (
                                        <span className="text-red-300 text-[11px]">{m.secretError}</span>
                                      ) : m.lastTestOk === true ? (
                                        <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[11px] font-semibold">Connected</span>
                                      ) : m.lastTestOk === false ? (
                                        <>
                                          <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">Login failed</span>
                                          <p className="text-red-300/80 text-[10px] mt-1">{m.lastTestMessage}</p>
                                        </>
                                      ) : (
                                        <span className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded text-[11px] font-semibold">Not tested</span>
                                      )}
                                      {m.lastTestAt && (
                                        <p className="text-netflix-muted text-[10px] mt-1">{new Date(m.lastTestAt).toLocaleString("en-IN")}</p>
                                      )}
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                        <Button
                                          onClick={() => handleTestMailbox2(m)}
                                          disabled={busy || Boolean(m.secretError)}
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-[11px] px-2 border-netflix-border text-netflix-light hover:text-white bg-transparent cursor-pointer"
                                        >
                                          {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Mail className="w-3 h-3 mr-1" />}
                                          Test
                                        </Button>
                                        {m.id && (
                                          <>
                                            <button
                                              onClick={() => {
                                                setMbxEditingId(m.id)
                                                setMbxUser(m.gmailUser)
                                                setMbxLabel(m.label)
                                                setMbxPass("")
                                                setMbxMsg(null)
                                              }}
                                              className="text-netflix-muted hover:text-white p-1 cursor-pointer"
                                              title="Replace the app password"
                                            >
                                              <Edit className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteMailbox(m)}
                                              className="text-netflix-muted hover:text-red-400 p-1 cursor-pointer"
                                              title="Remove this inbox"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>

                    <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-netflix-red" />
                        {mbxEditingId ? "Replace the app password" : "Add a Gmail inbox"}
                      </h2>
                      <form onSubmit={handleSaveMailbox} className="space-y-3.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-netflix-light block">Gmail address</label>
                            <Input
                              type="email"
                              value={mbxUser}
                              onChange={(e) => setMbxUser(e.target.value.trim())}
                              disabled={Boolean(mbxEditingId)}
                              placeholder="yourname@gmail.com"
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                              required
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-netflix-light block">Google app password</label>
                            <Input
                              type="password"
                              autoComplete="off"
                              value={mbxPass}
                              onChange={(e) => setMbxPass(e.target.value)}
                              placeholder={mbxEditingId ? "Enter the new app password" : "xxxx xxxx xxxx xxxx"}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                              required
                            />
                          </div>
                        </div>
                        <div className="space-y-1 sm:max-w-[50%]">
                          <label className="text-xs font-medium text-netflix-light block">Label (optional)</label>
                          <Input
                            value={mbxLabel}
                            onChange={(e) => setMbxLabel(e.target.value)}
                            placeholder="e.g. Flex inbox"
                            className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                            maxLength={60}
                          />
                        </div>
                        <p className="text-[11px] text-netflix-muted leading-relaxed">
                          An app password is a 16-letter code Google makes for apps: open{" "}
                          <span className="font-mono">myaccount.google.com/apppasswords</span> (2-Step Verification must be on). Your normal Gmail
                          password will not work. The login is tested as soon as you save.
                        </p>

                        {mbxMsg && <p className={`text-xs font-medium ${mbxMsg.ok ? "text-green-400" : "text-red-400"}`}>{mbxMsg.text}</p>}

                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            disabled={mbxBusy === "save" || Boolean(mailboxesError)}
                            className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer"
                          >
                            {mbxBusy === "save" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                            {mbxEditingId ? "Save new password" : "Save inbox"}
                          </Button>
                          {(mbxEditingId || mbxUser || mbxPass) && (
                            <Button
                              type="button"
                              onClick={resetMailboxForm}
                              variant="outline"
                              className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </form>
                    </Card>
                  </>
                )}

                {settingsSection === "payments" && (
                  <>
                    <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                      <div>
                        <h2 className="text-base font-bold text-white">Plans & Prices</h2>
                        <p className="text-netflix-muted text-xs leading-relaxed">
                          What customers can buy on the Buy Plan tab. Every plan is shown as 4K UHD, 1 Device. Prices are in rupees. Turn a plan
                          off to hide it; old orders keep their details.
                        </p>
                      </div>
                      <form onSubmit={handleSavePlans} className="space-y-3">
                        <div className="hidden sm:grid grid-cols-[90px_1fr_110px_70px_36px] gap-2 text-[10px] uppercase tracking-wider text-netflix-muted px-1">
                          <span>Months</span>
                          <span>Name</span>
                          <span>Price (₹)</span>
                          <span>On</span>
                          <span />
                        </div>
                        {planRows.map((r, i) => (
                          <div key={i} className="grid grid-cols-2 sm:grid-cols-[90px_1fr_110px_70px_36px] gap-2 items-center">
                            <Input
                              type="number"
                              value={r.months}
                              onChange={(e) => setPlanRows(planRows.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)))}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              min={1}
                              max={60}
                              aria-label="Months"
                            />
                            <Input
                              value={r.label}
                              onChange={(e) => setPlanRows(planRows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              maxLength={40}
                              aria-label="Name"
                            />
                            <Input
                              type="number"
                              value={r.price}
                              onChange={(e) => setPlanRows(planRows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                              className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                              min={1}
                              aria-label="Price"
                            />
                            <label className="flex items-center gap-1.5 text-xs text-netflix-light cursor-pointer">
                              <input
                                type="checkbox"
                                checked={r.enabled}
                                onChange={(e) => setPlanRows(planRows.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                                className="rounded border-netflix-border"
                              />
                              On
                            </label>
                            <button
                              type="button"
                              onClick={() => setPlanRows(planRows.filter((_, j) => j !== i))}
                              className="text-netflix-muted hover:text-red-400 p-1 cursor-pointer justify-self-end"
                              title="Remove this plan"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          <Button
                            type="button"
                            onClick={() => setPlanRows([...planRows, { months: "", label: "", price: "", enabled: true }])}
                            disabled={planRows.length >= MAX_PLANS}
                            variant="outline"
                            className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" /> Add plan
                          </Button>
                          <Button type="submit" className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer">
                            Save Plans
                          </Button>
                        </div>
                        {plansMsg && <p className={`text-xs font-medium ${plansMsg.ok ? "text-green-400" : "text-red-400"}`}>{plansMsg.text}</p>}
                      </form>
                    </Card>

                <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-white">Online Purchase (PayPur)</h2>
                      <p className="text-netflix-muted text-xs leading-relaxed">
                        Customers pay for the plans above on the Buy Plan tab. Paste the keys from PayPur &gt; API &amp; SDK &gt; Credentials.</p>
                    </div>
                    {paypur?.configured ? (
                      <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] px-2.5 py-0.5 rounded font-semibold shrink-0">
                        ON
                      </span>
                    ) : (
                      <span className="bg-red-500/20 text-red-300 border border-red-500/40 text-[11px] px-2.5 py-0.5 rounded font-semibold shrink-0">
                        OFF
                      </span>
                    )}
                  </div>

                  {paypur?.error && (
                    <p className="text-[11px] text-red-300">
                      Could not read the saved keys ({paypur.error}). Run <span className="font-mono">03_dreamlabs_payments.sql</span> first.
                    </p>
                  )}

                  <form onSubmit={handleSavePaypur} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-netflix-light block">Paypur Gateway Key</label>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={paypurKeyInput}
                        onChange={(e) => setPaypurKeyInput(e.target.value)}
                        placeholder={paypur?.keyHint ? `Saved (ends with ${paypur.keyHint}). Enter a new one to replace.` : "API key (X-PAYPUR-KEY)"}
                        className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-netflix-light block">Paypur Gateway Salt</label>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={paypurSaltInput}
                        onChange={(e) => setPaypurSaltInput(e.target.value)}
                        placeholder={paypur?.saltSet ? "Saved. Enter a new one to replace." : "Signing secret"}
                        className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                      />
                      <p className="text-[11px] text-netflix-muted">
                        The salt is used only on the server to sign payments and check PayPur&apos;s replies. It is never shown again.
                      </p>
                    </div>

                    <div className="bg-netflix-dark/60 border border-netflix-border/50 rounded-lg p-3 text-[11px] text-netflix-muted space-y-1">
                      <p className="text-netflix-light font-medium">Return URLs this site gives PayPur:</p>
                      <p className="font-mono break-all">
                        {typeof window !== "undefined" ? window.location.origin : ""}/api/paypur/callback/success
                      </p>
                      <p className="font-mono break-all">
                        {typeof window !== "undefined" ? window.location.origin : ""}/api/paypur/callback/failure
                      </p>
                    </div>

                    {paypurMsg && <p className={`text-xs font-medium ${paypurMsg.ok ? "text-green-400" : "text-red-400"}`}>{paypurMsg.text}</p>}

                    <div className="flex gap-2">
                      <Button type="submit" className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                        Save PayPur Keys
                      </Button>
                      {(paypur?.keyHint || paypur?.saltSet) && (
                        <Button
                          type="button"
                          onClick={handleClearPaypur}
                          variant="outline"
                          className="border-netflix-border text-netflix-muted hover:text-red-400 text-xs h-10 bg-transparent cursor-pointer"
                        >
                          Remove keys
                        </Button>
                      )}
                    </div>
                  </form>
                </Card>

                  </>
                )}

                {settingsSection === "backup" && (
                  <>
                <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                  <h2 className="text-base font-bold text-white">Database Backup & Portability</h2>
                  <p className="text-netflix-muted text-xs leading-relaxed">
                    Download a full JSON snapshot of your customer database, Netflix cookie vault, and activity logs. Restoring a backup
                    merges its customers by mobile number; nothing is deleted.
                  </p>
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      onClick={handleDownloadBackup}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-10 bg-transparent cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" /> Download Database Backup (JSON)
                    </Button>

                    <label className="border border-netflix-border text-white hover:bg-netflix-input text-xs h-10 px-4 rounded-md inline-flex items-center gap-1.5 cursor-pointer bg-transparent transition-colors">
                      <Upload className="w-3.5 h-3.5" /> Restore Database
                      <input type="file" accept=".json" onChange={handleRestoreBackup} className="hidden" />
                    </label>
                  </div>
                </Card>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* MODAL 1: ADD / EDIT CUSTOMER */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">{editingCustomer ? "Edit Customer" : "Add New Customer"}</h3>
              <button onClick={() => setShowAddCustomerModal(false)} className="text-netflix-muted hover:text-white p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Mobile Number (10 Digits)</label>
                <Input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={custMobile}
                  onChange={(e) => setCustMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="bg-netflix-input border-netflix-border text-white font-mono text-sm h-10"
                  maxLength={10}
                  required
                />
                {!editingCustomer && (
                  <p className="text-[11px] text-netflix-muted">
                    If this number already exists, its Netflix ID and expiry are updated instead.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Netflix ID (email)</label>
                <Input
                  type="email"
                  placeholder="e.g. name+4@gmail.com"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value.trim())}
                  className="bg-netflix-input border-netflix-border text-white font-mono text-xs h-10"
                  required
                />
                <p className="text-[11px] text-netflix-muted">
                  The customer never sees or picks this. It decides which Gmail inbox and which cookies are used for them.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Date of Expiry</label>
                <Input
                  type="date"
                  value={custExpDate}
                  onChange={(e) => setCustExpDate(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white font-mono text-xs h-10"
                  required
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    ["+1 Month", 1],
                    ["+3 Months", 3],
                    ["+6 Months", 6],
                    ["+1 Year", 12],
                  ].map(([label, months]) => (
                    <button
                      key={label as string}
                      type="button"
                      onClick={() => setCustExpDate(addMonthsIso(todayIso(), months as number))}
                      className="px-2 py-1 rounded border border-netflix-border text-[11px] text-netflix-gray hover:text-white hover:border-netflix-red/60 cursor-pointer"
                    >
                      {label as string}
                    </button>
                  ))}
                  <span className="text-[11px] text-netflix-muted self-center">from today</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="blockCheck"
                  checked={custBlocked}
                  onChange={(e) => setCustBlocked(e.target.checked)}
                  className="rounded border-netflix-border text-netflix-red focus:ring-netflix-red"
                />
                <label htmlFor="blockCheck" className="text-xs text-netflix-light cursor-pointer">
                  Block user access immediately
                </label>
              </div>

              {formError && <p className="text-red-400 text-xs">{formError}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                  {editingCustomer ? "Update Customer" : "Add Customer"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  variant="outline"
                  className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 2: BULK IMPORT FROM SHEET */}
      {showBulkImportModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-3xl bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Bulk Import Customers from Sheet</h3>
                <p className="text-netflix-muted text-xs">
                  Copy the three columns from Google Sheets or Excel: NETFLIX ID, MOBILE NUMBER, EXPIRY.
                </p>
              </div>
              <button onClick={closeBulkImport} className="text-netflix-muted hover:text-white p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="border-2 border-dashed border-netflix-border hover:border-netflix-red/60 rounded-xl p-4 flex items-center justify-center gap-3 cursor-pointer bg-netflix-dark/50 hover:bg-netflix-dark/80 transition-all text-center">
                <div className="w-10 h-10 rounded-full bg-netflix-red/10 text-netflix-red flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-white">Click to Select CSV File</p>
                  <p className="text-[11px] text-netflix-muted">Upload any .csv exported from Google Sheets or Excel</p>
                </div>
                <input type="file" accept=".csv,.txt,.tsv" onChange={handleCsvFileUpload} className="hidden" />
              </label>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-netflix-border/60 w-full" />
                <span className="bg-netflix-card px-3 text-[11px] text-netflix-muted uppercase tracking-wider absolute">
                  Or paste rows directly
                </span>
              </div>

              <textarea
                rows={5}
                placeholder={`Paste your rows here, e.g.:
yourname@gmail.com    91 98765 43210    12-Oct-26
yourname+4@gmail.com    91 91234 56789    15-Jan-27`}
                value={bulkText}
                onChange={(e) => handleBulkTextChange(e.target.value)}
                className="w-full bg-netflix-input border border-netflix-border rounded-lg p-3 text-xs text-white font-mono placeholder:text-netflix-muted"
              />
              <p className="text-[11px] text-netflix-muted">
                Reads the Netflix ID (email), the mobile number (91 prefix and spaces are fine) and the expiry date (14-Jan-27,
                14/01/2027 or 2027-01-14). A mobile number that already exists is updated with the new Netflix ID and expiry, and
                rows with no mobile number are skipped. If a number appears twice, the later expiry is kept.
              </p>
            </div>

            {bulkParsed && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <p className="font-semibold text-white">{bulkParsed.rows.length} customers ready to import</p>
                  {bulkParsed.emptySeats > 0 && (
                    <span className="text-netflix-muted">{bulkParsed.emptySeats} empty rows skipped</span>
                  )}
                  {bulkParsed.duplicates > 0 && (
                    <span className="text-netflix-muted">{bulkParsed.duplicates} repeated numbers merged</span>
                  )}
                  {bulkParsed.rows.filter((r) => r.expiryDate < today).length > 0 && (
                    <span className="text-yellow-400">
                      {bulkParsed.rows.filter((r) => r.expiryDate < today).length} already expired
                    </span>
                  )}
                </div>

                {bulkParsed.problems.length > 0 && (
                  <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-2.5 text-[11px] text-red-200 space-y-0.5 max-h-24 overflow-y-auto">
                    <p className="font-semibold text-red-300">{bulkParsed.problems.length} line(s) need attention (not imported):</p>
                    {bulkParsed.problems.slice(0, 20).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                )}

                {bulkParsed.rows.length > 0 && (
                  <div className="max-h-48 overflow-y-auto border border-netflix-border rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-netflix-dark text-netflix-muted text-[10px] uppercase sticky top-0">
                        <tr>
                          <th className="p-2">Netflix ID</th>
                          <th className="p-2">Mobile</th>
                          <th className="p-2">Expiry</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-netflix-border/40">
                        {bulkParsed.rows.map((r: ParsedRow, i) => (
                          <tr key={i} className="font-mono text-[11px]">
                            <td className="p-2 text-netflix-light break-all">{r.netflixEmail}</td>
                            <td className="p-2 text-white">+91 {r.mobile}</td>
                            <td className={`p-2 font-semibold ${r.expiryDate < today ? "text-yellow-400" : "text-green-400"}`}>
                              {r.expiryDate}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {bulkMessage && <p className="text-xs text-yellow-400">{bulkMessage}</p>}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleExecuteBulkImport}
                disabled={!bulkParsed?.rows.length || bulkBusy}
                className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer"
              >
                {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Import {bulkParsed?.rows.length || 0} Customers
              </Button>
              <Button
                onClick={closeBulkImport}
                variant="outline"
                className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 3: ADD / EDIT NETFLIX COOKIES */}
      {showAddCookieModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">
                {editingCookie ? "Update Netflix Cookies" : "Add Netflix Account Cookies"}
              </h3>
              <button onClick={() => setShowAddCookieModal(false)} className="text-netflix-muted hover:text-white p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCookie} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Netflix ID (email)</label>
                <Input
                  type="email"
                  placeholder="e.g. name+4@gmail.com"
                  value={cookieEmail}
                  onChange={(e) => setCookieEmail(e.target.value.trim())}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-10 font-mono"
                  required
                />
                <p className="text-[11px] text-netflix-muted">
                  Must be the same Netflix ID as in the customer sheet: it links these cookies to those customers. Adding cookies for
                  an ID that is already in the vault replaces them.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Account Name / Label (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. Netflix 4K Account 1"
                  value={cookieProfileName}
                  onChange={(e) => setCookieProfileName(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Cookie JSON Export</label>
                <textarea
                  rows={8}
                  placeholder={`Paste JSON exported from Cookie-Editor / EditThisCookie:
[
  {
    "name": "NetflixId",
    "value": "...",
    "domain": ".netflix.com"
  },
  {
    "name": "SecureNetflixId",
    "value": "...",
    "domain": ".netflix.com"
  }
]`}
                  value={cookieRawJson}
                  onChange={(e) => setCookieRawJson(e.target.value)}
                  className="w-full bg-netflix-input border border-netflix-border rounded-lg p-2.5 text-xs text-white font-mono placeholder:text-netflix-muted"
                  required
                />
                <p className="text-[11px] text-netflix-muted">
                  Must include <span className="font-mono text-white">NetflixId</span> and{" "}
                  <span className="font-mono text-white">SecureNetflixId</span> cookies.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-netflix-light font-medium block">Bound Device User-Agent</label>
                  <button
                    type="button"
                    onClick={() => setCookieUserAgent(typeof navigator !== "undefined" ? navigator.userAgent : "")}
                    className="text-[11px] text-netflix-red hover:underline cursor-pointer"
                  >
                    Auto-Detect Browser
                  </button>
                </div>
                <Input
                  type="text"
                  placeholder="e.g. Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)..."
                  value={cookieUserAgent}
                  onChange={(e) => setCookieUserAgent(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-9 font-mono"
                />
                <p className="text-[11px] text-netflix-muted">
                  Used for keepalive and TV login requests so Netflix sees the exact same browser/device footprint.
                </p>
              </div>

              {cookieError && <p className="text-red-400 text-xs">{cookieError}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                  {editingCookie ? "Update Account & Session" : "Save to Vault"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowAddCookieModal(false)}
                  variant="outline"
                  className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 4: CUSTOMER HISTORY DETAIL */}
      {selectedCustomerHistory && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Usage History: +91 {selectedCustomerHistory.mobile}</h3>
                <p className="text-netflix-muted text-xs font-mono break-all">{selectedCustomerHistory.netflixEmail}</p>
                <p className="text-netflix-muted text-xs">Successful updates and TV logins: {selectedCustomerHistory.totalUpdates}</p>
              </div>
              <button onClick={() => setSelectedCustomerHistory(null)} className="text-netflix-muted hover:text-white p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {!selectedCustomerHistory.history || selectedCustomerHistory.history.length === 0 ? (
                <p className="text-netflix-muted text-xs py-6 text-center">No update or TV login history recorded yet</p>
              ) : (
                <div className="divide-y divide-netflix-border/50">
                  {selectedCustomerHistory.history.map((h, i) => (
                    <div key={i} className="py-2.5 text-xs flex justify-between items-center gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              h.action === "tv_login" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                            }`}
                          >
                            {h.action === "tv_login" ? "TV Login" : "Household Update"}
                          </span>
                          <span className={h.status === "success" ? "text-green-400" : "text-red-400"}>
                            {h.status === "success" ? "Success" : h.status === "rate_limited" ? "Limit reached" : "Failed"}
                          </span>
                          {h.code && <span className="font-mono text-white">Code: {h.code}</span>}
                        </div>
                        {h.notes && <p className="text-netflix-muted text-[11px]">{h.notes}</p>}
                      </div>
                      <span className="text-netflix-muted font-mono whitespace-nowrap">
                        {new Date(h.date).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button
                onClick={() => setSelectedCustomerHistory(null)}
                className="w-full bg-netflix-input hover:bg-netflix-input/80 text-white text-xs h-9 cursor-pointer"
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
