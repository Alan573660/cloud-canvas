import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import "@/i18n";

import { AppLayout } from "@/components/layout/AppLayout";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import OnboardingPage from "@/pages/onboarding/OnboardingPage";
import DashboardPage from "@/pages/DashboardPage";
import ContactsPage from "@/pages/contacts/ContactsPage";
import CompaniesPage from "@/pages/companies/CompaniesPage";
import LeadsPage from "@/pages/leads/LeadsPage";
import LeadDetailPage from "@/pages/leads/LeadDetailPage";
import OrdersPage from "@/pages/orders/OrdersPage";
import OrderDetailPage from "@/pages/orders/OrderDetailPage";
import InvoicesPage from "@/pages/invoices/InvoicesPage";
import InvoiceDetailPage from "@/pages/invoices/InvoiceDetailPage";
import ProductsPage from "@/pages/products/ProductsPage";
import EmailPage from "@/pages/email/EmailPage";
import BillingPage from "@/pages/billing/BillingPage";
import AnalyticsPage from "@/pages/analytics/AnalyticsPage";
import ImportPage from "@/pages/import/ImportPage";
import SettingsPage from "@/pages/settings/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="contacts" element={<ContactsPage />} />
              <Route path="companies" element={<CompaniesPage />} />
              <Route path="leads" element={<LeadsPage />} />
              <Route path="leads/:id" element={<LeadDetailPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/new" element={<OrderDetailPage />} />
              <Route path="orders/:id" element={<OrderDetailPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="email" element={<EmailPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
