import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Building2,
  Target,
  ShoppingCart,
  FileText,
  Package,
  Mail,
  Phone,
  CreditCard,
  BarChart3,
  Upload,
  Settings,
  ChevronDown,
  LogOut,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

interface MenuItem {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  roles?: string[]; // If specified, only these roles can see this item
}

interface MenuGroup {
  key: string;
  labelKey?: string;
  items: MenuItem[];
  roles?: string[]; // If specified, only these roles can see this group
}

const menuGroups: MenuGroup[] = [
  {
    key: 'main',
    items: [
      { key: 'dashboard', icon: LayoutDashboard, path: '/dashboard' },
    ],
  },
  {
    key: 'crm',
    labelKey: 'nav.crm',
    items: [
      { key: 'contacts', icon: Users, path: '/contacts' },
      { key: 'companies', icon: Building2, path: '/companies' },
      { key: 'leads', icon: Target, path: '/leads' },
    ],
  },
  {
    key: 'orders',
    labelKey: 'nav.orders',
    items: [
      { key: 'orders', icon: ShoppingCart, path: '/orders' },
      { key: 'invoices', icon: FileText, path: '/invoices' },
    ],
  },
  {
    key: 'catalog',
    labelKey: 'nav.catalog',
    items: [
      { key: 'products', icon: Package, path: '/products' },
    ],
  },
  {
    key: 'communications',
    labelKey: 'nav.communications',
    items: [
      { key: 'email', icon: Mail, path: '/email' },
      { key: 'calls', icon: Phone, path: '/calls' },
    ],
  },
  {
    key: 'finance',
    labelKey: 'nav.finance',
    // Only owner, admin, accountant can see this group (operator cannot)
    roles: ['owner', 'admin', 'accountant'],
    items: [
      { key: 'billing', icon: CreditCard, path: '/billing' },
      { key: 'analytics', icon: BarChart3, path: '/analytics' },
    ],
  },
  {
    key: 'data',
    labelKey: 'nav.import',
    items: [
      { key: 'import', icon: Upload, path: '/import' },
    ],
  },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { state } = useSidebar();
  const { signOut, profile } = useAuth();
  const collapsed = state === 'collapsed';
  const userRole = profile?.role || '';

  const isActive = (path: string) => location.pathname === path;
  const isGroupActive = (items: MenuItem[]) =>
    items.some((item) => location.pathname.startsWith(item.path));

  // Check if user can see an item or group
  const canSee = (roles?: string[]) => {
    if (!roles || roles.length === 0) return true;
    return roles.includes(userRole);
  };

  // Filter visible groups and items
  const visibleGroups = menuGroups
    .filter((group) => canSee(group.roles))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSee(item.roles)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            S
          </div>
          {!collapsed && (
            <span className="font-semibold text-sidebar-foreground">
              SellerRoof
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.key}>
            {group.labelKey ? (
              <Collapsible
                defaultOpen={isGroupActive(group.items)}
                className="group/collapsible"
              >
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex w-full items-center justify-between">
                    <span>{t(group.labelKey)}</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.path)}
                            tooltip={t(`nav.${item.key}`)}
                          >
                            <NavLink
                              to={item.path}
                              className="flex items-center gap-2"
                            >
                              <item.icon className="h-4 w-4" />
                              <span>{t(`nav.${item.key}`)}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(item.path)}
                        tooltip={t(`nav.${item.key}`)}
                      >
                        <NavLink
                          to={item.path}
                          className="flex items-center gap-2"
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{t(`nav.${item.key}`)}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive('/settings')}
              tooltip={t('nav.settings')}
            >
              <NavLink to="/settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span>{t('nav.settings')}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={signOut}
              tooltip={t('auth.logout')}
              className="text-destructive hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              <span>{t('auth.logout')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
