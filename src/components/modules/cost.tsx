"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  Wallet,
  Receipt,
  Plus,
  Search,
  Filter,
  ArrowUpRight,
  Sparkles,
  Cpu,
  Megaphone,
  Users,
  Layers,
  Server,
  Briefcase,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Download,
  UploadCloud,
  Trash2,
  Edit3,
  RefreshCw,
  Clock,
  CreditCard,
  TrendingUp,
  PieChart,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  X,
  FileCheck,
} from "lucide-react";
import { Button, Field, IconButton, Modal, Select, Textarea, useToast } from "@/components/ui";

type TabKey =
  | "overview"
  | "expenses"
  | "invoices"
  | "investments"
  | "ai"
  | "marketing"
  | "recurring"
  | "reports"
  | "categories";

export function CostModule() {
  const toast = useToast();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);

  // Dashboard Data
  const [dashboardRange, setDashboardRange] = useState("all");
  const [dashboardData, setDashboardData] = useState<any>({
    summary: {
      totalInvestment: 0,
      totalExpenses: 0,
      thisMonthExpenses: 0,
      recurringMonthly: 0,
      totalAiCost: 0,
      totalMarketingSpend: 0,
      totalClientsAcquired: 0,
      cac: 0,
    },
    monthlyTrend: [],
    categoryBreakdown: [],
    recentTransactions: [],
    upcomingBills: [],
  });

  // Categories
  const [categories, setCategories] = useState<any[]>([]);

  // Expenses Tab State
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseTotalBase, setExpenseTotalBase] = useState(0);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [expenseStatusFilter, setExpenseStatusFilter] = useState("");
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any | null>(null);

  // Expense Form State
  const [expTitle, setExpTitle] = useState("");
  const [expVendor, setExpVendor] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expCurrency, setExpCurrency] = useState("INR");
  const [expCustomRate, setExpCustomRate] = useState("");
  const [expClassification, setExpClassification] = useState("OPEX");
  const [expCategoryId, setExpCategoryId] = useState("");
  const [expSubcategoryId, setExpSubcategoryId] = useState("");
  const [expPaymentMethod, setExpPaymentMethod] = useState("BANK_TRANSFER");
  const [expPaymentStatus, setExpPaymentStatus] = useState("PAID");
  const [expPaymentDate, setExpPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [expInvoiceNumber, setExpInvoiceNumber] = useState("");
  const [expIsRecurring, setExpIsRecurring] = useState(false);
  const [expTaxAmount, setExpTaxAmount] = useState("0");
  const [expNotes, setExpNotes] = useState("");
  const [expAttachmentFiles, setExpAttachmentFiles] = useState<any[]>([]);

  // Invoices Tab State
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string[] | null>(null);
  const [activeVerifyInvoice, setActiveVerifyInvoice] = useState<any | null>(null);
  const [verifyVendor, setVerifyVendor] = useState("");
  const [verifyInvoiceNumber, setVerifyInvoiceNumber] = useState("");
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyCurrency, setVerifyCurrency] = useState("INR");
  const [verifyCategoryId, setVerifyCategoryId] = useState("");
  const [verifySubcategoryId, setVerifySubcategoryId] = useState("");
  const [verifyCreateExpense, setVerifyCreateExpense] = useState(true);

  // Investments Tab State
  const [investments, setInvestments] = useState<any[]>([]);
  const [totalInvestedBase, setTotalInvestedBase] = useState(0);
  const [investmentModalOpen, setInvestmentModalOpen] = useState(false);
  const [invTitle, setInvTitle] = useState("");
  const [invInvestorName, setInvInvestorName] = useState("");
  const [invInvestorType, setInvInvestorType] = useState("FOUNDER");
  const [invType, setInvType] = useState("FOUNDER_CAPITAL");
  const [invAmount, setInvAmount] = useState("");
  const [invCurrency, setInvCurrency] = useState("INR");
  const [invEquity, setInvEquity] = useState("");
  const [invRefNo, setInvRefNo] = useState("");
  const [invDate, setInvDate] = useState(new Date().toISOString().slice(0, 10));
  const [invNotes, setInvNotes] = useState("");

  // AI Usage Tab State
  const [aiRecords, setAiRecords] = useState<any[]>([]);
  const [aiSummary, setAiSummary] = useState<any>({
    totalCostBase: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    byProvider: {},
    byModel: {},
  });
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiProvider, setAiProvider] = useState("DEEPSEEK");
  const [aiModel, setAiModel] = useState("deepseek-flash");
  const [aiPurpose, setAiPurpose] = useState("VOICE_ASSISTANT");
  const [aiPromptTokens, setAiPromptTokens] = useState("");
  const [aiCompletionTokens, setAiCompletionTokens] = useState("");
  const [aiCostAmount, setAiCostAmount] = useState("");
  const [aiCurrency, setAiCurrency] = useState("USD");

  // Marketing Tab State
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [marketingSummary, setMarketingSummary] = useState<any>({
    totalSpentBase: 0,
    totalLeads: 0,
    totalClients: 0,
    totalRevenue: 0,
    totalConnects: 0,
    totalProposals: 0,
    cpl: 0,
    cac: 0,
    roi: 0,
  });
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campName, setCampName] = useState("");
  const [campPlatform, setCampPlatform] = useState("UPWORK");
  const [campType, setCampType] = useState("UPWORK_BIDDING");
  const [campSpent, setCampSpent] = useState("");
  const [campCurrency, setCampCurrency] = useState("INR");
  const [campLeads, setCampLeads] = useState("0");
  const [campClients, setCampClients] = useState("0");
  const [campRevenue, setCampRevenue] = useState("0");
  const [campConnects, setCampConnects] = useState("0");
  const [campProposals, setCampProposals] = useState("0");

  // Recurring Tab State
  const [recurringList, setRecurringList] = useState<any[]>([]);
  const [monthlyBurn, setMonthlyBurn] = useState(0);
  const [recurringModalOpen, setRecurringModalOpen] = useState(false);
  const [recTitle, setRecTitle] = useState("");
  const [recVendor, setRecVendor] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recCurrency, setRecCurrency] = useState("INR");
  const [recCategoryId, setRecCategoryId] = useState("");
  const [recBillingCycle, setRecBillingCycle] = useState("MONTHLY");
  const [recNextDueDate, setRecNextDueDate] = useState(new Date().toISOString().slice(0, 10));

  // Category Management Modal (Admin)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [catParentId, setCatParentId] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Dashboard Data
  const loadDashboard = async () => {
    try {
      const res = await fetch(`/api/cost/dashboard?range=${dashboardRange}`);
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Categories
  const loadCategories = async () => {
    try {
      const res = await fetch("/api/cost/categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Expenses
  const loadExpenses = async () => {
    try {
      let url = `/api/cost/expenses?search=${encodeURIComponent(expenseSearch)}`;
      if (expenseCategoryFilter) url += `&categoryId=${expenseCategoryFilter}`;
      if (expenseStatusFilter) url += `&paymentStatus=${expenseStatusFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
        setExpenseTotalBase(data.totalAmountBase || 0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Invoices
  const loadInvoices = async () => {
    try {
      const res = await fetch(`/api/cost/invoices?search=${encodeURIComponent(invoiceSearch)}`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Investments
  const loadInvestments = async () => {
    try {
      const res = await fetch("/api/cost/investments");
      if (res.ok) {
        const data = await res.json();
        setInvestments(data.investments || []);
        setTotalInvestedBase(data.totalInvestedBase || 0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load AI Usage
  const loadAiUsage = async () => {
    try {
      const res = await fetch("/api/cost/ai");
      if (res.ok) {
        const data = await res.json();
        setAiRecords(data.records || []);
        setAiSummary(data.summary || {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Marketing
  const loadMarketing = async () => {
    try {
      const res = await fetch("/api/cost/marketing");
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
        setMarketingSummary(data.summary || {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load Recurring
  const loadRecurring = async () => {
    try {
      const res = await fetch("/api/cost/recurring");
      if (res.ok) {
        const data = await res.json();
        setRecurringList(data.recurring || []);
        setMonthlyBurn(data.monthlyBurn || 0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Initial Load with role-scoped data fetching
  useEffect(() => {
    setLoading(true);
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then(async (data) => {
        const user = data?.user || null;
        setCurrentUser(user);
        const isMember = user?.role === "MEMBER";
        if (isMember) {
          setActiveTab("expenses");
          await Promise.all([
            loadCategories(),
            loadExpenses(),
            loadInvoices(),
          ]);
        } else {
          await Promise.all([
            loadDashboard(),
            loadCategories(),
            loadExpenses(),
            loadInvoices(),
            loadInvestments(),
            loadAiUsage(),
            loadMarketing(),
            loadRecurring(),
          ]);
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  // Reload dashboard on range change (admin only)
  useEffect(() => {
    if (currentUser && currentUser.role !== "MEMBER") {
      loadDashboard();
    }
  }, [dashboardRange]);

  // Reload expenses on filter change
  useEffect(() => {
    loadExpenses();
  }, [expenseSearch, expenseCategoryFilter, expenseStatusFilter]);

  // Subcategories available based on selected category in form
  const availableSubcategories = useMemo(() => {
    if (!expCategoryId) return [];
    const parent = categories.find((c) => c.id === expCategoryId);
    return parent?.children || [];
  }, [expCategoryId, categories]);

  const verifyAvailableSubcategories = useMemo(() => {
    if (!verifyCategoryId) return [];
    const parent = categories.find((c) => c.id === verifyCategoryId);
    return parent?.children || [];
  }, [verifyCategoryId, categories]);

  // Format currency display (Default: INR ₹)
  const fmtCurrency = (amount: number, curr = "INR") => {
    const locale = curr === "INR" ? "en-IN" : "en-US";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: curr || "INR",
      maximumFractionDigits: 2,
    }).format(amount || 0);
  };

  // Handlers for Expense
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle || !expVendor || !expAmount || !expCategoryId) {
      toast("Please fill all required fields.", "error");
      return;
    }

    try {
      const payload: any = {
        title: expTitle,
        vendor: expVendor,
        amount: parseFloat(expAmount),
        currency: expCurrency,
        customExchangeRate: expCustomRate ? parseFloat(expCustomRate) : undefined,
        classification: expClassification,
        categoryId: expCategoryId,
        subcategoryId: expSubcategoryId || null,
        paymentMethod: expPaymentMethod,
        paymentStatus: expPaymentStatus,
        paymentDate: expPaymentDate,
        invoiceNumber: expInvoiceNumber || null,
        isRecurring: expIsRecurring,
        taxAmount: parseFloat(expTaxAmount) || 0,
        notes: expNotes || null,
      };

      let res;
      if (editingExpense) {
        res = await fetch(`/api/cost/expenses/${editingExpense.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/cost/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        toast(editingExpense ? "Expense updated" : "Expense recorded successfully", "success");
        setExpenseModalOpen(false);
        setEditingExpense(null);
        resetExpenseForm();
        loadExpenses();
        loadDashboard();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to save expense", "error");
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const resetExpenseForm = () => {
    setExpTitle("");
    setExpVendor("");
    setExpAmount("");
    setExpCurrency("INR");
    setExpCustomRate("");
    setExpClassification("OPEX");
    setExpCategoryId("");
    setExpSubcategoryId("");
    setExpPaymentMethod("BANK_TRANSFER");
    setExpPaymentStatus("PAID");
    setExpPaymentDate(new Date().toISOString().slice(0, 10));
    setExpInvoiceNumber("");
    setExpIsRecurring(false);
    setExpTaxAmount("0");
    setExpNotes("");
  };

  const handleEditExpense = (expense: any) => {
    setEditingExpense(expense);
    setExpTitle(expense.title);
    setExpVendor(expense.vendor);
    setExpAmount(String(expense.amount));
    setExpCurrency(expense.currency);
    setExpCustomRate(String(expense.exchangeRate));
    setExpClassification(expense.classification || "OPEX");
    setExpCategoryId(expense.categoryId);
    setExpSubcategoryId(expense.subcategoryId || "");
    setExpPaymentMethod(expense.paymentMethod);
    setExpPaymentStatus(expense.paymentStatus);
    setExpPaymentDate(new Date(expense.paymentDate).toISOString().slice(0, 10));
    setExpInvoiceNumber(expense.invoiceNumber || "");
    setExpIsRecurring(expense.isRecurring);
    setExpTaxAmount(String(expense.taxAmount || 0));
    setExpNotes(expense.notes || "");
    setExpenseModalOpen(true);
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("Are you sure you want to delete this expense?")) return;
    try {
      const res = await fetch(`/api/cost/expenses/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Expense removed", "success");
        loadExpenses();
        loadDashboard();
      }
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  // Handlers for Invoices
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingInvoice(true);
    setDuplicateWarning(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/cost/invoices/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        if (data.warnings && data.warnings.length > 0) {
          setDuplicateWarning(data.warnings);
          toast(data.warnings[0], "error");
        } else {
          toast("Invoice metadata prefilled by AI parser.", "success");
        }

        // Open verification modal
        openVerifyModal(data.invoice, data.extractedData);
        loadInvoices();
      } else {
        toast(data.error || "Could not process file", "error");
      }
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setUploadingInvoice(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openVerifyModal = (invoice: any, extracted?: any) => {
    setActiveVerifyInvoice(invoice);
    setVerifyVendor(extracted?.vendor || invoice.vendor);
    setVerifyInvoiceNumber(extracted?.invoiceNumber || invoice.invoiceNumber);
    setVerifyAmount(String(extracted?.totalAmount || invoice.totalAmount || ""));
    setVerifyCurrency(extracted?.currency || invoice.currency || "USD");
    setVerifyCategoryId(categories[0]?.id || "");
    setVerifySubcategoryId("");
    setVerifyCreateExpense(true);
  };

  const handleVerifyInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVerifyInvoice) return;

    try {
      const res = await fetch("/api/cost/invoices/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: activeVerifyInvoice.id,
          vendor: verifyVendor,
          invoiceNumber: verifyInvoiceNumber,
          totalAmount: parseFloat(verifyAmount) || 0,
          currency: verifyCurrency,
          categoryId: verifyCategoryId,
          subcategoryId: verifySubcategoryId || null,
          createExpense: verifyCreateExpense,
        }),
      });

      if (res.ok) {
        toast("Invoice confirmed and recorded.", "success");
        setActiveVerifyInvoice(null);
        loadInvoices();
        loadExpenses();
        loadDashboard();
      } else {
        const err = await res.json();
        toast(err.error || "Verification failed", "error");
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Handlers for Investment
  const handleSaveInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invTitle || !invInvestorName || !invAmount) {
      toast("Title, Investor, and Amount are required.", "error");
      return;
    }

    try {
      const res = await fetch("/api/cost/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: invTitle,
          investorName: invInvestorName,
          investorType: invInvestorType,
          type: invType,
          amount: parseFloat(invAmount),
          currency: invCurrency,
          equityPercentage: invEquity ? parseFloat(invEquity) : null,
          referenceNumber: invRefNo || null,
          date: invDate,
          notes: invNotes || null,
        }),
      });

      if (res.ok) {
        toast("Capital investment successfully stored.", "success");
        setInvestmentModalOpen(false);
        setInvTitle("");
        setInvInvestorName("");
        setInvAmount("");
        loadInvestments();
        loadDashboard();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to save investment", "error");
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const handleDeleteInvestment = async (id: string) => {
    if (!confirm("Are you sure you want to delete this investment record?")) return;
    try {
      const res = await fetch(`/api/cost/investments?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Investment record removed", "success");
        loadInvestments();
        loadDashboard();
      }
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  // Handlers for AI Usage
  const handleSaveAiUsage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/cost/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiProvider,
          model: aiModel,
          purpose: aiPurpose,
          promptTokens: parseInt(aiPromptTokens, 10) || 0,
          completionTokens: parseInt(aiCompletionTokens, 10) || 0,
          costAmount: parseFloat(aiCostAmount) || 0,
          currency: aiCurrency,
        }),
      });

      if (res.ok) {
        toast("AI Usage and token expense recorded.", "success");
        setAiModalOpen(false);
        setAiPromptTokens("");
        setAiCompletionTokens("");
        setAiCostAmount("");
        loadAiUsage();
        loadDashboard();
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Handlers for Marketing
  const handleSaveMarketing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campName) return;

    try {
      const res = await fetch("/api/cost/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campName,
          platform: campPlatform,
          campaignType: campType,
          spentAmount: parseFloat(campSpent) || 0,
          currency: campCurrency,
          leadsGenerated: parseInt(campLeads, 10) || 0,
          clientsAcquired: parseInt(campClients, 10) || 0,
          revenueGenerated: parseFloat(campRevenue) || 0,
          connectsUsed: parseInt(campConnects, 10) || 0,
          proposalsSent: parseInt(campProposals, 10) || 0,
        }),
      });

      if (res.ok) {
        toast("Marketing campaign metrics recorded.", "success");
        setCampaignModalOpen(false);
        setCampName("");
        setCampSpent("");
        loadMarketing();
        loadDashboard();
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Handlers for Recurring
  const handleSaveRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recTitle || !recVendor || !recAmount || !recCategoryId) return;

    try {
      const res = await fetch("/api/cost/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: recTitle,
          vendor: recVendor,
          amount: parseFloat(recAmount) || 0,
          currency: recCurrency,
          categoryId: recCategoryId,
          billingCycle: recBillingCycle,
          nextDueDate: recNextDueDate,
        }),
      });

      if (res.ok) {
        toast("Recurring subscription recorded.", "success");
        setRecurringModalOpen(false);
        setRecTitle("");
        setRecVendor("");
        setRecAmount("");
        loadRecurring();
        loadDashboard();
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const handleRecordRecurringPayment = async (recurringId: string, dueDate?: string) => {
    try {
      const res = await fetch("/api/cost/recurring/record-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurringId, dueDate }),
      });

      if (res.ok) {
        const data = await res.json();
        toast(data.message || "Payment recorded", "success");
        loadRecurring();
        loadExpenses();
        loadDashboard();
      }
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  // Handlers for Category Management
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName) return;

    try {
      const res = await fetch("/api/cost/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: catName,
          description: catDescription,
          parentId: catParentId || null,
        }),
      });

      if (res.ok) {
        toast("Category added successfully.", "success");
        setCategoryModalOpen(false);
        setCatName("");
        setCatDescription("");
        setCatParentId("");
        loadCategories();
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Export Trigger (POST with safe blob download)
  const handleExport = async (type: string, format = "csv") => {
    try {
      const res = await fetch("/api/cost/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, format }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Export failed");
      }
      if (format === "json") {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cyraops_${type}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cyraops_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      toast(err.message || "Failed to export report", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent font-bold">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight">Cost Management</h1>
              <p className="text-xs text-[var(--muted)]">
                Capital investments, operating expenses, AI model usage, CAC & financial tracking
              </p>
            </div>
          </div>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={handleFileUpload}
            aria-label="Upload invoice or receipt document"
          />
          <Button
            variant="secondary"
            className="gap-2 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingInvoice}
          >
            <UploadCloud className="h-4 w-4" />
            {uploadingInvoice ? "Scanning Receipt..." : "Upload Invoice / Receipt"}
          </Button>

          <Button
            className="gap-2 text-xs"
            onClick={() => {
              resetExpenseForm();
              setEditingExpense(null);
              setExpenseModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-[var(--border)] overflow-x-auto scrollbar-none gap-1">
        {[
          { key: "overview", label: "Financial Overview", icon: PieChart, adminOnly: true },
          { key: "expenses", label: "Expenses & Reimbursements", icon: Receipt, adminOnly: false },
          { key: "invoices", label: "Invoices & Receipts", icon: FileText, adminOnly: false },
          { key: "investments", label: "Investments", icon: DollarSign, adminOnly: true },
          { key: "ai", label: "AI & API Costs", icon: Cpu, adminOnly: true },
          { key: "marketing", label: "Marketing & CAC", icon: Megaphone, adminOnly: true },
          { key: "recurring", label: "Recurring Bills", icon: Clock, adminOnly: true },
          { key: "reports", label: "Reports & Export", icon: Download, adminOnly: true },
          { key: "categories", label: "Categories", icon: Layers, adminOnly: true },
        ]
          .filter((tab) => currentUser?.role !== "MEMBER" || !tab.adminOnly)
          .map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition ${
                  isActive
                    ? "border-accent text-accent"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
      </div>

      {/* Access Guard for Members on Administrative Tabs */}
      {currentUser?.role === "MEMBER" && activeTab !== "expenses" && activeTab !== "invoices" && (
        <div className="p-8 text-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] space-y-3">
          <ShieldAlert className="h-10 w-10 text-amber-500 mx-auto" />
          <h3 className="text-base font-bold">Access Restricted</h3>
          <p className="text-xs text-[var(--muted)] max-w-md mx-auto">
            Executive financial metrics, cap tables, subscriptions, marketing analytics, and AI spend records are restricted to administrators.
          </p>
          <Button className="h-8 text-xs" onClick={() => setActiveTab("expenses")}>Go to My Expenses</Button>
        </div>
      )}

      {/* TAB 1: OVERVIEW / DASHBOARD */}
      {activeTab === "overview" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-6">
          {/* Filter Bar */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">Executive Summary</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">Period:</span>
              <select
                aria-label="Filter reporting period"
                value={dashboardRange}
                onChange={(e) => setDashboardRange(e.target.value)}
                className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--text)] outline-none"
              >
                <option value="all">All Time</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="30d">Last 30 Days</option>
                <option value="quarter">Last 90 Days</option>
                <option value="year">This Year</option>
              </select>
            </div>
          </div>

          {/* 6 Key Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Total Invested</span>
                <DollarSign className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
                {fmtCurrency(dashboardData.summary.totalInvestment)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">Founder capital & equity</div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Total Expenses</span>
                <Receipt className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-[var(--text)]">
                {fmtCurrency(dashboardData.summary.totalExpenses)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">All operational spending</div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>This Month</span>
                <TrendingUp className="h-4 w-4 text-sky-500" />
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-sky-600 dark:text-sky-400">
                {fmtCurrency(dashboardData.summary.thisMonthExpenses)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">Current monthly burn</div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Recurring / Mo</span>
                <Clock className="h-4 w-4 text-purple-500" />
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-purple-600 dark:text-purple-400">
                {fmtCurrency(dashboardData.summary.recurringMonthly)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">Active SaaS & subscriptions</div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Client Acq. Cost</span>
                <Users className="h-4 w-4 text-rose-500" />
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-rose-600 dark:text-rose-400">
                {fmtCurrency(dashboardData.summary.cac)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">
                {dashboardData.summary.totalClientsAcquired} clients acquired
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>AI & API Cost</span>
                <Cpu className="h-4 w-4 text-indigo-500" />
              </div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-indigo-600 dark:text-indigo-400">
                {fmtCurrency(dashboardData.summary.totalAiCost)}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">DeepSeek & model usage</div>
            </div>
          </div>

          {/* Charts & Breakdown Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly Trend Chart (SVG) */}
            <div className="lg:col-span-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold">Monthly Spending & Investment Trend</h3>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                    <span>Expenses</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span>Investments</span>
                  </div>
                </div>
              </div>

              {dashboardData.monthlyTrend?.length > 0 ? (
                <div className="h-56 flex items-end gap-4 pt-4 border-b border-[var(--border)]">
                  {(() => {
                    const maxVal = Math.max(
                      100,
                      ...dashboardData.monthlyTrend.map((m: any) => Math.max(m.expenses, m.investments))
                    );
                    return dashboardData.monthlyTrend.map((m: any, idx: number) => {
                      const expHeight = Math.max(4, Math.round((m.expenses / maxVal) * 160));
                      const invHeight = Math.max(4, Math.round((m.investments / maxVal) * 160));
                      return (
                        <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                          <div className="w-full flex items-end justify-center gap-1">
                            <div
                              style={{ height: `${expHeight}px` }}
                              className="w-1/2 max-w-[24px] bg-accent/80 group-hover:bg-accent rounded-t transition"
                              title={`Expenses: $${m.expenses}`}
                            />
                            <div
                              style={{ height: `${invHeight}px` }}
                              className="w-1/2 max-w-[24px] bg-emerald-500/80 group-hover:bg-emerald-500 rounded-t transition"
                              title={`Investment: $${m.investments}`}
                            />
                          </div>
                          <span className="text-[10px] text-[var(--muted)] mt-1">{m.label}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-[var(--muted)]">
                  No monthly trend data recorded yet.
                </div>
              )}
            </div>

            {/* Category Breakdown Progress Bars */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-4">
              <h3 className="text-sm font-bold">Category Distribution</h3>
              <div className="space-y-3">
                {dashboardData.categoryBreakdown?.length > 0 ? (
                  dashboardData.categoryBreakdown.map((cat: any) => (
                    <div key={cat.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--text)]">{cat.name}</span>
                        <span className="text-[var(--muted)]">
                          {fmtCurrency(cat.amount)} ({cat.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[var(--hover)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, cat.percentage)}%`,
                            backgroundColor: cat.color || "#6366f1",
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-[var(--muted)]">No category expenses yet.</div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Grid: Recent Transactions & Upcoming Subscriptions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Transactions */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Recent Expenses</h3>
                <button
                  onClick={() => setActiveTab("expenses")}
                  className="text-xs text-accent hover:underline flex items-center gap-1"
                >
                  View All <ChevronRight className="h-3 w-3" />
                </button>
              </div>

              <div className="divide-y divide-[var(--border)]">
                {dashboardData.recentTransactions?.length > 0 ? (
                  dashboardData.recentTransactions.map((tx: any) => (
                    <div key={tx.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-[var(--text)]">{tx.title}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {tx.vendor} • {tx.categoryName} • {new Date(tx.paymentDate).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-[var(--text)]">
                          {fmtCurrency(tx.amount, tx.currency)}
                        </div>
                        {tx.currency !== "INR" && (
                          <div className="text-[10px] text-[var(--muted)]">({fmtCurrency(tx.amountBase, "INR")})</div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-xs text-[var(--muted)]">No recent transactions recorded.</div>
                )}
              </div>
            </div>

            {/* Upcoming Recurring Bills */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Upcoming Recurring Bills</h3>
                <button
                  onClick={() => setActiveTab("recurring")}
                  className="text-xs text-accent hover:underline flex items-center gap-1"
                >
                  Manage <ChevronRight className="h-3 w-3" />
                </button>
              </div>

              <div className="divide-y divide-[var(--border)]">
                {dashboardData.upcomingBills?.length > 0 ? (
                  dashboardData.upcomingBills.map((bill: any) => (
                    <div key={bill.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-[var(--text)]">{bill.title}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          Due: {new Date(bill.nextDueDate).toLocaleDateString()} ({bill.billingCycle})
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="font-bold text-[var(--text)]">
                          {fmtCurrency(bill.amount, bill.currency)}
                        </div>
                        <button
                          onClick={() => handleRecordRecurringPayment(bill.id, bill.nextDueDate)}
                          className="px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 text-[11px] font-semibold transition"
                          title="Record payment & advance schedule"
                        >
                          Mark Paid
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-xs text-[var(--muted)]">No upcoming recurring bills.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EXPENSES TABLE */}
      {activeTab === "expenses" && (
        <div className="space-y-4">
          {/* Controls & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
                <input
                  type="text"
                  placeholder="Search title, vendor, invoice#..."
                  aria-label="Search expenses by title, vendor, or invoice number"
                  value={expenseSearch}
                  onChange={(e) => setExpenseSearch(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-3 text-xs outline-none focus:border-accent"
                />
              </div>

              <select
                value={expenseCategoryFilter}
                aria-label="Filter expenses by category"
                onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--text)] outline-none"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={expenseStatusFilter}
                onChange={(e) => setExpenseStatusFilter(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--text)] outline-none"
              >
                <option value="">All Statuses</option>
                <option value="PAID">Paid</option>
                <option value="PENDING">Pending</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="REIMBURSEMENT_PENDING">Reimbursement</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted)]">
                Total: <strong className="text-[var(--text)]">{fmtCurrency(expenseTotalBase)}</strong>
              </span>
              <Button
                variant="secondary"
                className="h-9 text-xs gap-1.5"
                onClick={() => handleExport("expenses", "csv")}
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
              <Button
                className="h-9 text-xs gap-1.5"
                onClick={() => {
                  resetExpenseForm();
                  setEditingExpense(null);
                  setExpenseModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add Expense
              </Button>
            </div>
          </div>

          {/* Expenses Table */}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--muted)]">
                  <th className="py-2.5 px-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Title / Vendor</th>
                  <th className="py-2.5 px-3 font-semibold">Category</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Base (INR)</th>
                  <th className="py-2.5 px-3 font-semibold">Method</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Receipt</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {expenses.length > 0 ? (
                  expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-[var(--hover)] transition">
                      <td className="py-2.5 px-3 whitespace-nowrap text-[var(--muted)]">
                        {new Date(e.paymentDate).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-[var(--text)] flex items-center gap-1.5">
                          {e.title}
                          {e.classification === "CAPEX" && (
                            <span className="text-[9px] bg-blue-500/10 text-blue-600 px-1 py-0.2 rounded font-bold">CAPEX</span>
                          )}
                          {e.classification === "REFUND" && (
                            <span className="text-[9px] bg-rose-500/10 text-rose-600 px-1 py-0.2 rounded font-bold">REFUND</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {e.vendor} {e.invoiceNumber ? `• #${e.invoiceNumber}` : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold"
                          style={{
                            backgroundColor: `${e.category?.color || "#6366f1"}20`,
                            color: e.category?.color || "#6366f1",
                          }}
                        >
                          {e.category?.name}
                        </span>
                        {e.subcategory && (
                          <div className="text-[10px] text-[var(--muted)] mt-0.5">{e.subcategory.name}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">
                        {fmtCurrency(e.amount, e.currency)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-[var(--text)]">
                        {fmtCurrency(e.amountBase, "INR")}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--muted)]">{e.paymentMethod}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            e.paymentStatus === "PAID"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : e.paymentStatus === "PENDING"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          }`}
                        >
                          {e.paymentStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {e.attachments?.length > 0 || e.invoices?.length > 0 ? (
                          <span title="Receipt attached" className="inline-block text-accent">
                            <FileCheck className="h-4 w-4 inline" />
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            label="Edit Expense"
                            className="h-7 w-7"
                            onClick={() => handleEditExpense(e)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="Delete Expense"
                            className="h-7 w-7 text-rose-500 hover:text-rose-600"
                            onClick={() => handleDeleteExpense(e.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-xs text-[var(--muted)]">
                      No expenses match your search or filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: INVOICES & RECEIPTS */}
      {activeTab === "invoices" && (
        <div className="space-y-4">
          {/* Upload Dropzone Banner */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-[var(--border)] hover:border-accent rounded-2xl p-6 text-center cursor-pointer transition bg-[var(--surface)] group"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent group-hover:scale-110 transition">
              <UploadCloud className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-sm font-bold">Upload Invoice or Payment Receipt</h3>
            <p className="mt-1 text-xs text-[var(--muted)] max-w-md mx-auto">
              Drop PDF, PNG, or JPG receipts here. AI automatically extracts vendor, date, invoice #, and amount.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> Intelligent Duplicate Detection & AI Prefill
            </div>
          </div>

          {/* Duplicate Detection Alert Banner if triggered */}
          {duplicateWarning && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-2 text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2 font-bold">
                <ShieldAlert className="h-4 w-4" />
                Duplicate Invoice Risk Detected:
              </div>
              <ul className="list-disc pl-5 space-y-1">
                {duplicateWarning.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="text-[11px] text-[var(--muted)]">
                Please verify this invoice carefully before creating an expense.
              </div>
            </div>
          )}

          {/* Invoices List */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Processed Invoices & Receipts</h3>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
              <input
                type="text"
                placeholder="Search vendor, file, invoice#..."
                aria-label="Search invoices by vendor, file, or invoice number"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-3 text-xs outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--muted)]">
                  <th className="py-2.5 px-3 font-semibold">Upload Date</th>
                  <th className="py-2.5 px-3 font-semibold">Vendor</th>
                  <th className="py-2.5 px-3 font-semibold">Invoice #</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-3 font-semibold">File</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {invoices.length > 0 ? (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-[var(--hover)] transition">
                      <td className="py-2.5 px-3 whitespace-nowrap text-[var(--muted)]">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{inv.vendor}</td>
                      <td className="py-2.5 px-3 font-mono">{inv.invoiceNumber}</td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        {fmtCurrency(inv.totalAmount, inv.currency)}
                      </td>
                      <td className="py-2.5 px-3 max-w-[200px] truncate" title={inv.fileName}>
                        <a
                          href={`/api/cost/invoices/${inv.id}/download?preview=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-1 font-medium"
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{inv.fileName}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            inv.status === "VERIFIED"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {inv.status === "DRAFT" ? (
                          <Button
                            className="h-7 px-2.5 text-[11px]"
                            onClick={() => openVerifyModal(inv)}
                          >
                            Verify & Record
                          </Button>
                        ) : (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-end gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-[var(--muted)]">
                      No invoices uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: INVESTMENTS */}
      {activeTab === "investments" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">Capital Investment Ledger</h2>
              <p className="text-xs text-[var(--muted)]">
                Strict separation of founder capital & equity investments from operational expenses.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--muted)]">
                Total Invested: <strong className="text-emerald-500">{fmtCurrency(totalInvestedBase)}</strong>
              </span>
              <Button
                variant="secondary"
                className="h-9 text-xs gap-1.5"
                onClick={() => handleExport("investments", "csv")}
              >
                <Download className="h-3.5 w-3.5" /> Export Ledger
              </Button>
              <Button className="h-9 text-xs gap-1.5" onClick={() => setInvestmentModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Record Investment
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--muted)]">
                  <th className="py-2.5 px-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Title</th>
                  <th className="py-2.5 px-3 font-semibold">Investor</th>
                  <th className="py-2.5 px-3 font-semibold">Accounting Classification</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Base (INR)</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Equity %</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {investments.length > 0 ? (
                  investments.map((inv) => (
                    <tr key={inv.id} className="hover:bg-[var(--hover)] transition">
                      <td className="py-2.5 px-3 whitespace-nowrap text-[var(--muted)]">
                        {new Date(inv.date).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[var(--text)]">{inv.title}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold">{inv.investorName}</div>
                        <div className="text-[10px] text-[var(--muted)]">{inv.investorType}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        {inv.type === "LOAN" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            DEBT LIABILITY (LOAN)
                          </span>
                        ) : inv.type === "EQUIPMENT" || inv.type === "IP_SOFTWARE" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            CAPITALIZED ASSET
                          </span>
                        ) : inv.type === "GRANT" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400">
                            GRANT (NON-EQUITY)
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            CONTRIBUTED EQUITY
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">
                        {fmtCurrency(inv.amount, inv.currency)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {fmtCurrency(inv.amountBase, "INR")}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        {inv.equityPercentage !== null ? `${inv.equityPercentage}%` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <IconButton
                          label="Delete Investment"
                          className="h-7 w-7 text-rose-500 hover:text-rose-600"
                          onClick={() => handleDeleteInvestment(inv.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-[var(--muted)]">
                      No capital investments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: AI & API USAGE */}
      {activeTab === "ai" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">AI Model & API Usage</h2>
              <p className="text-xs text-[var(--muted)]">
                Track token consumption and API billing for DeepSeek, OpenAI, Anthropic, and voice models.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="h-9 text-xs gap-1.5"
                onClick={() => handleExport("ai", "csv")}
              >
                <Download className="h-3.5 w-3.5" /> Export Usage
              </Button>
              <Button className="h-9 text-xs gap-1.5" onClick={() => setAiModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Log AI Usage
              </Button>
            </div>
          </div>

          {/* AI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Total AI Cost</div>
              <div className="mt-1 text-xl font-extrabold text-indigo-500">
                {fmtCurrency(aiSummary.totalCostBase)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Total Tokens Processed</div>
              <div className="mt-1 text-xl font-extrabold text-[var(--text)]">
                {aiSummary.totalTokens.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Prompt Tokens</div>
              <div className="mt-1 text-xl font-extrabold text-[var(--text)]">
                {aiSummary.totalPromptTokens.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Completion Tokens</div>
              <div className="mt-1 text-xl font-extrabold text-[var(--text)]">
                {aiSummary.totalCompletionTokens.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--muted)]">
                  <th className="py-2.5 px-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Provider</th>
                  <th className="py-2.5 px-3 font-semibold">Model</th>
                  <th className="py-2.5 px-3 font-semibold">Purpose</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Tokens</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Cost (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {aiRecords.length > 0 ? (
                  aiRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-[var(--hover)] transition">
                      <td className="py-2.5 px-3 whitespace-nowrap text-[var(--muted)]">
                        {new Date(r.usageDate).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{r.provider}</td>
                      <td className="py-2.5 px-3 font-mono">{r.model}</td>
                      <td className="py-2.5 px-3 text-[var(--muted)]">{r.purpose}</td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {r.totalTokens.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-indigo-500">
                        {fmtCurrency(r.costAmountBase)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-[var(--muted)]">
                      No AI model usage recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 6: MARKETING & ACQUISITION */}
      {activeTab === "marketing" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">
                Marketing, Upwork & CAC Performance
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Calculate client acquisition costs, Upwork proposal bidding effectiveness, and ROI.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="h-9 text-xs gap-1.5"
                onClick={() => handleExport("marketing", "csv")}
              >
                <Download className="h-3.5 w-3.5" /> Export Campaigns
              </Button>
              <Button className="h-9 text-xs gap-1.5" onClick={() => setCampaignModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Campaign / Bid
              </Button>
            </div>
          </div>

          {/* Marketing Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Total Ad & Bid Spend</div>
              <div className="mt-1 text-xl font-extrabold text-[var(--text)]">
                {fmtCurrency(marketingSummary.totalSpentBase)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Leads & Clients</div>
              <div className="mt-1 text-xl font-extrabold text-[var(--text)]">
                {marketingSummary.totalLeads} leads • {marketingSummary.totalClients} clients
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Client Acquisition Cost (CAC)</div>
              <div className="mt-1 text-xl font-extrabold text-rose-500">
                {fmtCurrency(marketingSummary.cac)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-xs text-[var(--muted)]">Campaign ROI</div>
              <div className="mt-1 text-xl font-extrabold text-emerald-500">
                {marketingSummary.roi}%
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--muted)]">
                  <th className="py-2.5 px-3 font-semibold">Campaign</th>
                  <th className="py-2.5 px-3 font-semibold">Platform</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Spend</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Leads</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Clients</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Revenue</th>
                  <th className="py-2.5 px-3 font-semibold text-right">CAC</th>
                  <th className="py-2.5 px-3 font-semibold text-center">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {campaigns.length > 0 ? (
                  campaigns.map((c) => {
                    const cacVal = c.clientsAcquired > 0 ? c.spentAmountBase / c.clientsAcquired : c.spentAmountBase;
                    const roiVal =
                      c.spentAmountBase > 0
                        ? (((c.revenueGenerated - c.spentAmountBase) / c.spentAmountBase) * 100).toFixed(0)
                        : "0";
                    return (
                      <tr key={c.id} className="hover:bg-[var(--hover)] transition">
                        <td className="py-2.5 px-3 font-semibold">{c.name}</td>
                        <td className="py-2.5 px-3">{c.platform}</td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {fmtCurrency(c.spentAmountBase)}
                        </td>
                        <td className="py-2.5 px-3 text-center">{c.leadsGenerated}</td>
                        <td className="py-2.5 px-3 text-center font-bold">{c.clientsAcquired}</td>
                        <td className="py-2.5 px-3 text-right font-medium text-emerald-500">
                          {fmtCurrency(c.revenueGenerated)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-rose-500">
                          {fmtCurrency(cacVal)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              parseFloat(roiVal) >= 0
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {roiVal}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-[var(--muted)]">
                      No marketing campaigns or bidding records added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: RECURRING EXPENSES */}
      {activeTab === "recurring" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">
                Recurring Subscriptions & Schedules
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Active monthly burn: <strong className="text-purple-500">{fmtCurrency(monthlyBurn)}/mo</strong>
              </p>
            </div>
            <Button className="h-9 text-xs gap-1.5" onClick={() => setRecurringModalOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Subscription
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--muted)]">
                  <th className="py-2.5 px-3 font-semibold">Subscription</th>
                  <th className="py-2.5 px-3 font-semibold">Vendor</th>
                  <th className="py-2.5 px-3 font-semibold">Billing Cycle</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-3 font-semibold">Next Due Date</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {recurringList.length > 0 ? (
                  recurringList.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[var(--hover)] transition">
                      <td className="py-2.5 px-3 font-semibold">{rec.title}</td>
                      <td className="py-2.5 px-3">{rec.vendor}</td>
                      <td className="py-2.5 px-3 text-[var(--muted)]">{rec.billingCycle}</td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        {fmtCurrency(rec.amount, rec.currency)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium">
                        {new Date(rec.nextDueDate).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            rec.status === "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-neutral-500/10 text-neutral-600"
                          }`}
                        >
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => handleRecordRecurringPayment(rec.id, rec.nextDueDate)}
                        >
                          Mark Paid This Period
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-xs text-[var(--muted)]">
                      No recurring subscriptions added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 8: REPORTS & EXPORT */}
      {activeTab === "reports" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">Financial Data Exports</h2>
            <p className="text-xs text-[var(--muted)]">
              Download complete, audit-ready CSV spreadsheets and JSON files for your company financials.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Receipt className="h-4 w-4 text-accent" />
                Expenses Ledger
              </div>
              <p className="text-xs text-[var(--muted)]">
                Every operating expense with date, vendor, original & base currencies, tax, category, and receipts.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <Button className="h-8 text-xs flex-1 gap-1" onClick={() => handleExport("expenses", "csv")}>
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="secondary" className="h-8 text-xs flex-1" onClick={() => handleExport("expenses", "json")}>
                  JSON
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                Investments Ledger
              </div>
              <p className="text-xs text-[var(--muted)]">
                Founder capital, angel equity, loans, and equipment tracking strictly separated from operations.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <Button className="h-8 text-xs flex-1 gap-1" onClick={() => handleExport("investments", "csv")}>
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="secondary" className="h-8 text-xs flex-1" onClick={() => handleExport("investments", "json")}>
                  JSON
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Cpu className="h-4 w-4 text-indigo-500" />
                AI Model & API Usage
              </div>
              <p className="text-xs text-[var(--muted)]">
                Detailed token logs, prompt/completion ratios, provider invoices, and per-model costs.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <Button className="h-8 text-xs flex-1 gap-1" onClick={() => handleExport("ai", "csv")}>
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="secondary" className="h-8 text-xs flex-1" onClick={() => handleExport("ai", "json")}>
                  JSON
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Megaphone className="h-4 w-4 text-amber-500" />
                Marketing & CAC Report
              </div>
              <p className="text-xs text-[var(--muted)]">
                Campaign performance, Upwork proposal costs, lead acquisition rates, and return on ad spend.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <Button className="h-8 text-xs flex-1 gap-1" onClick={() => handleExport("marketing", "csv")}>
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
                <Button variant="secondary" className="h-8 text-xs flex-1" onClick={() => handleExport("marketing", "json")}>
                  JSON
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 9: CATEGORIES (ADMIN) */}
      {activeTab === "categories" && currentUser?.role !== "MEMBER" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted)]">
                Category & Subcategory Hierarchy
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Pre-populated standard categories and custom company spending classifications.
              </p>
            </div>
            <Button className="h-9 text-xs gap-1.5" onClick={() => setCategoryModalOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Category / Subcategory
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((cat) => (
              <div key={cat.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: cat.color || "#6366f1" }}
                    />
                    <h3 className="font-bold text-sm">{cat.name}</h3>
                  </div>
                  {cat.isDefault && (
                    <span className="text-[10px] bg-[var(--hover)] text-[var(--muted)] px-1.5 py-0.5 rounded font-mono">
                      DEFAULT
                    </span>
                  )}
                </div>
                {cat.description && <p className="text-xs text-[var(--muted)]">{cat.description}</p>}

                <div className="pt-2 border-t border-[var(--border)]">
                  <div className="text-[11px] font-semibold text-[var(--muted)] mb-1.5">Subcategories:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.children?.length > 0 ? (
                      cat.children.map((sub: any) => (
                        <span
                          key={sub.id}
                          className="px-2 py-0.5 rounded text-[11px] bg-[var(--hover)] text-[var(--text)] border border-[var(--border)]"
                        >
                          {sub.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-[var(--muted)] italic">No subcategories</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL 1: ADD / EDIT EXPENSE */}
      <Modal
        open={expenseModalOpen}
        onClose={() => {
          setExpenseModalOpen(false);
          setEditingExpense(null);
        }}
        title={editingExpense ? "Edit Expense" : "Record New Expense"}
        size="max-w-2xl"
      >
        <form onSubmit={handleSaveExpense} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Expense Title *"
              placeholder="e.g. GitHub Team Subscription"
              value={expTitle}
              onChange={(e) => setExpTitle(e.target.value)}
              required
            />
            <Field
              label="Vendor / Payee *"
              placeholder="e.g. GitHub Inc, Google, AWS"
              value={expVendor}
              onChange={(e) => setExpVendor(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Field
              label="Amount *"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              required
            />
            <Select
              label="Currency"
              value={expCurrency}
              onChange={(e) => setExpCurrency(e.target.value)}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="AED">AED (د.إ)</option>
              <option value="CAD">CAD ($)</option>
              <option value="AUD">AUD ($)</option>
              <option value="SGD">SGD ($)</option>
            </Select>
            <Select
              label="Classification"
              value={expClassification}
              onChange={(e) => setExpClassification(e.target.value)}
            >
              <option value="OPEX">Operating Expense (Opex)</option>
              <option value="CAPEX">Capital Expenditure (Capex)</option>
              <option value="REIMBURSEMENT">Reimbursement</option>
              <option value="REFUND">Vendor Refund / Credit</option>
            </Select>
            <Field
              label="Exchange Rate (to INR)"
              placeholder="1.0 for INR, 86.5 for USD"
              value={expCustomRate}
              onChange={(e) => setExpCustomRate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Primary Category *"
              value={expCategoryId}
              onChange={(e) => {
                setExpCategoryId(e.target.value);
                setExpSubcategoryId("");
              }}
              required
            >
              <option value="">Select Category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select
              label="Subcategory (Optional)"
              value={expSubcategoryId}
              onChange={(e) => setExpSubcategoryId(e.target.value)}
              disabled={availableSubcategories.length === 0}
            >
              <option value="">None / General</option>
              {availableSubcategories.map((sub: any) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Payment Method"
              value={expPaymentMethod}
              onChange={(e) => setExpPaymentMethod(e.target.value)}
            >
              <option value="BANK_TRANSFER">Bank Wire / Transfer</option>
              <option value="CREDIT_CARD">Credit Card</option>
              <option value="DEBIT_CARD">Debit Card</option>
              <option value="UPI">UPI</option>
              <option value="PAYPAL">PayPal</option>
              <option value="CASH">Cash</option>
              <option value="OTHER">Other</option>
            </Select>

            <Select
              label="Payment Status"
              value={expPaymentStatus}
              onChange={(e) => setExpPaymentStatus(e.target.value)}
            >
              <option value="PAID">Paid</option>
              <option value="PENDING">Pending</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="REIMBURSEMENT_PENDING">Reimbursement</option>
            </Select>

            <Field
              label="Payment Date"
              type="date"
              value={expPaymentDate}
              onChange={(e) => setExpPaymentDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Invoice / Receipt Number"
              placeholder="e.g. INV-2026-904"
              value={expInvoiceNumber}
              onChange={(e) => setExpInvoiceNumber(e.target.value)}
            />
            <Field
              label="Tax Amount (Included/Excluded)"
              type="number"
              step="0.01"
              value={expTaxAmount}
              onChange={(e) => setExpTaxAmount(e.target.value)}
            />
          </div>

          <Textarea
            label="Notes & Business Purpose"
            rows={2}
            placeholder="Add internal notes, client attribution, or billing context..."
            value={expNotes}
            onChange={(e) => setExpNotes(e.target.value)}
          />

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={expIsRecurring}
                onChange={(e) => setExpIsRecurring(e.target.checked)}
                className="rounded border-[var(--border)]"
              />
              Mark as Recurring Subscription
            </label>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setExpenseModalOpen(false);
                  setEditingExpense(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editingExpense ? "Save Changes" : "Save Expense"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* MODAL 2: INVOICE AI PREFILL & VERIFICATION */}
      <Modal
        open={Boolean(activeVerifyInvoice)}
        onClose={() => setActiveVerifyInvoice(null)}
        title="Verify AI-Extracted Receipt"
        size="max-w-xl"
      >
        {activeVerifyInvoice && (
          <form onSubmit={handleVerifyInvoice} className="space-y-4">
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/20 text-xs text-accent space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" /> AI Field Extraction Verification
              </div>
              <p className="text-[var(--text)]">
                Please review and confirm the extracted values before creating the official expense entry.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Vendor Name *"
                value={verifyVendor}
                onChange={(e) => setVerifyVendor(e.target.value)}
                required
              />
              <Field
                label="Invoice Number *"
                value={verifyInvoiceNumber}
                onChange={(e) => setVerifyInvoiceNumber(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Total Amount *"
                type="number"
                step="0.01"
                value={verifyAmount}
                onChange={(e) => setVerifyAmount(e.target.value)}
                required
              />
              <Select
                label="Currency"
                value={verifyCurrency}
                onChange={(e) => setVerifyCurrency(e.target.value)}
              >
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="AED">AED (د.إ)</option>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Category *"
                value={verifyCategoryId}
                onChange={(e) => setVerifyCategoryId(e.target.value)}
                required
              >
                <option value="">Select Category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

              <Select
                label="Subcategory"
                value={verifySubcategoryId}
                onChange={(e) => setVerifySubcategoryId(e.target.value)}
              >
                <option value="">None / General</option>
                {verifyAvailableSubcategories.map((sub: any) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </Select>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={verifyCreateExpense}
                onChange={(e) => setVerifyCreateExpense(e.target.checked)}
                className="rounded border-[var(--border)]"
              />
              Create linked operating expense immediately
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setActiveVerifyInvoice(null)}>
                Cancel
              </Button>
              <Button type="submit">Confirm & Save</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL 3: RECORD INVESTMENT */}
      <Modal
        open={investmentModalOpen}
        onClose={() => setInvestmentModalOpen(false)}
        title="Record Capital Investment"
        size="max-w-xl"
      >
        <form onSubmit={handleSaveInvestment} className="space-y-4">
          <Field
            label="Investment Title *"
            placeholder="e.g. Founder Seed Injection Q4"
            value={invTitle}
            onChange={(e) => setInvTitle(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Investor Name *"
              placeholder="e.g. Tanveer Singh Saini"
              value={invInvestorName}
              onChange={(e) => setInvInvestorName(e.target.value)}
              required
            />
            <Select
              label="Investor Type"
              value={invInvestorType}
              onChange={(e) => setInvInvestorType(e.target.value)}
            >
              <option value="FOUNDER">Founder</option>
              <option value="INVESTOR">Angel Investor</option>
              <option value="PARTNER">Business Partner</option>
              <option value="INSTITUTION">Institution / Bank</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="Amount *"
              type="number"
              step="0.01"
              value={invAmount}
              onChange={(e) => setInvAmount(e.target.value)}
              required
            />
            <Select
              label="Currency"
              value={invCurrency}
              onChange={(e) => setInvCurrency(e.target.value)}
            >
              <option value="USD">USD ($)</option>
              <option value="INR">INR (₹)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </Select>
            <Select label="Type" value={invType} onChange={(e) => setInvType(e.target.value)}>
              <option value="FOUNDER_CAPITAL">Founder Capital</option>
              <option value="ANGEL_INVESTMENT">Angel Equity</option>
              <option value="EQUIPMENT">Hardware / Equipment</option>
              <option value="IP_SOFTWARE">IP & Software</option>
              <option value="LOAN">Loan</option>
              <option value="GRANT">Grant</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Equity Stake % (Optional)"
              type="number"
              step="0.1"
              placeholder="e.g. 10.0"
              value={invEquity}
              onChange={(e) => setInvEquity(e.target.value)}
            />
            <Field
              label="Reference / Transaction Number"
              placeholder="e.g. WIRE-8947192"
              value={invRefNo}
              onChange={(e) => setInvRefNo(e.target.value)}
            />
          </div>

          <Textarea
            label="Notes"
            rows={2}
            value={invNotes}
            onChange={(e) => setInvNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setInvestmentModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Record Investment</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 4: LOG AI USAGE */}
      <Modal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title="Log AI & LLM Model Usage"
        size="max-w-xl"
      >
        <form onSubmit={handleSaveAiUsage} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Provider" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
              <option value="DEEPSEEK">DeepSeek</option>
              <option value="OPENAI">OpenAI</option>
              <option value="ANTHROPIC">Anthropic Claude</option>
              <option value="GOOGLE">Google Gemini</option>
              <option value="COHERE">Cohere</option>
              <option value="OTHER">Other</option>
            </Select>
            <Field
              label="Model Identifier *"
              placeholder="e.g. deepseek-flash, gpt-4o"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Purpose / Workload"
              placeholder="e.g. Voice Assistant, Lead Research"
              value={aiPurpose}
              onChange={(e) => setAiPurpose(e.target.value)}
            />
            <Field
              label="Total Cost Amount *"
              type="number"
              step="0.001"
              placeholder="0.00"
              value={aiCostAmount}
              onChange={(e) => setAiCostAmount(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Prompt Tokens"
              type="number"
              value={aiPromptTokens}
              onChange={(e) => setAiPromptTokens(e.target.value)}
            />
            <Field
              label="Completion Tokens"
              type="number"
              value={aiCompletionTokens}
              onChange={(e) => setAiCompletionTokens(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAiModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Log Usage</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 5: ADD MARKETING CAMPAIGN */}
      <Modal
        open={campaignModalOpen}
        onClose={() => setCampaignModalOpen(false)}
        title="Record Marketing Campaign / Upwork Bidding"
        size="max-w-xl"
      >
        <form onSubmit={handleSaveMarketing} className="space-y-4">
          <Field
            label="Campaign / Bidding Name *"
            placeholder="e.g. Upwork Fullstack Proposal Connects"
            value={campName}
            onChange={(e) => setCampName(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Platform" value={campPlatform} onChange={(e) => setCampPlatform(e.target.value)}>
              <option value="UPWORK">Upwork</option>
              <option value="GOOGLE_ADS">Google Ads</option>
              <option value="META_ADS">Meta (Facebook/Instagram)</option>
              <option value="LINKEDIN_ADS">LinkedIn Ads</option>
              <option value="TWITTER_X">X / Twitter</option>
              <option value="OTHER">Other</option>
            </Select>

            <Select label="Type" value={campType} onChange={(e) => setCampType(e.target.value)}>
              <option value="UPWORK_BIDDING">Upwork Bidding & Boosts</option>
              <option value="UPWORK_CONNECTS">Upwork Connects</option>
              <option value="SEARCH_ADS">Search Ads</option>
              <option value="DISPLAY_ADS">Display Ads</option>
              <option value="SOCIAL_ADS">Social Media Ads</option>
              <option value="OUTREACH">Outreach</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Spend Amount *"
              type="number"
              step="0.01"
              value={campSpent}
              onChange={(e) => setCampSpent(e.target.value)}
              required
            />
            <Select
              label="Currency"
              value={campCurrency}
              onChange={(e) => setCampCurrency(e.target.value)}
            >
              <option value="USD">USD ($)</option>
              <option value="INR">INR (₹)</option>
              <option value="EUR">EUR (€)</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="Leads Generated"
              type="number"
              value={campLeads}
              onChange={(e) => setCampLeads(e.target.value)}
            />
            <Field
              label="Clients Acquired"
              type="number"
              value={campClients}
              onChange={(e) => setCampClients(e.target.value)}
            />
            <Field
              label="Revenue Generated"
              type="number"
              step="0.01"
              value={campRevenue}
              onChange={(e) => setCampRevenue(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Connects Used (Upwork)"
              type="number"
              value={campConnects}
              onChange={(e) => setCampConnects(e.target.value)}
            />
            <Field
              label="Proposals Sent"
              type="number"
              value={campProposals}
              onChange={(e) => setCampProposals(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCampaignModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Campaign</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 6: ADD RECURRING SUBSCRIPTION */}
      <Modal
        open={recurringModalOpen}
        onClose={() => setRecurringModalOpen(false)}
        title="Add Recurring Subscription"
        size="max-w-xl"
      >
        <form onSubmit={handleSaveRecurring} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Subscription Name *"
              placeholder="e.g. Cursor Pro Team"
              value={recTitle}
              onChange={(e) => setRecTitle(e.target.value)}
              required
            />
            <Field
              label="Vendor *"
              placeholder="e.g. Anysphere"
              value={recVendor}
              onChange={(e) => setRecVendor(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="Amount *"
              type="number"
              step="0.01"
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
              required
            />
            <Select
              label="Currency"
              value={recCurrency}
              onChange={(e) => setRecCurrency(e.target.value)}
            >
              <option value="USD">USD ($)</option>
              <option value="INR">INR (₹)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </Select>
            <Select
              label="Billing Cycle"
              value={recBillingCycle}
              onChange={(e) => setRecBillingCycle(e.target.value)}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUALLY">Annually</option>
              <option value="WEEKLY">Weekly</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Category *"
              value={recCategoryId}
              onChange={(e) => setRecCategoryId(e.target.value)}
              required
            >
              <option value="">Select Category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Field
              label="Next Due Date *"
              type="date"
              value={recNextDueDate}
              onChange={(e) => setRecNextDueDate(e.target.value)}
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setRecurringModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Subscription</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 7: ADD CATEGORY */}
      <Modal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title="Add Custom Category / Subcategory"
        size="max-w-md"
      >
        <form onSubmit={handleSaveCategory} className="space-y-4">
          <Field
            label="Category Name *"
            placeholder="e.g. Legal Retainers"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            required
          />

          <Select
            label="Parent Category (Leave empty for top-level)"
            value={catParentId}
            onChange={(e) => setCatParentId(e.target.value)}
          >
            <option value="">None (Top-Level Category)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          <Textarea
            label="Description"
            rows={2}
            value={catDescription}
            onChange={(e) => setCatDescription(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCategoryModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Category</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
