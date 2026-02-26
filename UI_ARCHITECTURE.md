# UI Architecture Documentation
## Salary Appraisal Workflow System

### Version: 1.0
### Date: February 26, 2026

---

## Technology Stack

- **Framework**: React 18+
- **Routing**: React Router v6
- **Styling**: Tailwind CSS 3+
- **State Management**: React Context API + React Query (TanStack Query)
- **Forms**: React Hook Form + Zod validation
- **Tables**: TanStack Table (React Table v8)
- **File Handling**: react-dropzone
- **PDF Viewing**: react-pdf
- **Charts**: Recharts
- **Date Handling**: date-fns
- **Icons**: Heroicons or Lucide React

---

## Project Structure

```
apps/web/src/
├── components/
│   ├── common/            # Reusable UI primitives
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Modal.tsx
│   │   ├── Badge.tsx
│   │   ├── Card.tsx
│   │   ├── Alert.tsx
│   │   ├── Spinner.tsx
│   │   ├── Table.tsx
│   │   └── FileUpload.tsx
│   ├── layout/            # Application shell components
│   │   ├── AppShell.tsx
│   │   ├── TopNav.tsx
│   │   ├── SideNav.tsx
│   │   ├── PageContainer.tsx
│   │   ├── PageHeader.tsx
│   │   └── Breadcrumbs.tsx
│   ├── cases/             # Case-specific components
│   │   ├── CaseTable.tsx
│   │   ├── CaseCard.tsx
│   │   ├── CaseFilters.tsx
│   │   ├── CompensationDisplay.tsx
│   │   ├── RecommendationCard.tsx
│   │   ├── OverrideForm.tsx
│   │   ├── ChecklistProgress.tsx
│   │   └── AuditTimeline.tsx
│   ├── cycles/            # Cycle management components
│   │   ├── CycleSelector.tsx
│   │   ├── CycleCard.tsx
│   │   ├── CycleStats.tsx
│   │   ├── CreateCycleModal.tsx
│   │   └── CycleActions.tsx
│   ├── uploads/           # Upload components
│   │   ├── UploadDropzone.tsx
│   │   ├── UploadHistory.tsx
│   │   ├── UploadProgress.tsx
│   │   └── QuestionableReport.tsx
│   ├── approvals/         # Approval evidence components
│   │   ├── ApprovalList.tsx
│   │   ├── ApprovalForm.tsx
│   │   ├── AttachmentUpload.tsx
│   │   ├── PDFViewer.tsx
│   │   └── DriveLink.tsx
│   ├── dashboard/         # Dashboard widgets
│   │   ├── MetricCard.tsx
│   │   ├── CompletionChart.tsx
│   │   ├── BlockersTable.tsx
│   │   └── OverridesAnalysis.tsx
│   └── admin/             # Admin portal components
│       ├── FieldGroupEditor.tsx
│       ├── PermissionsMatrix.tsx
│       ├── TenureBandManager.tsx
│       ├── BenchmarkManager.tsx
│       ├── ImpactPreview.tsx
│       └── UnmappedValuesManager.tsx
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── CyclesPage.tsx
│   ├── ImportsPage.tsx
│   ├── CasesListPage.tsx
│   ├── CaseDetailPage.tsx
│   └── admin/
│       ├── MarketRulesPage.tsx
│       ├── PermissionsPage.tsx
│       ├── UsersPage.tsx
│       └── UnmappedValuesPage.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useCases.ts
│   ├── useCycles.ts
│   ├── usePermissions.ts
│   ├── useDebounce.ts
│   └── useFileUpload.ts
├── services/
│   ├── api.ts             # Axios instance with interceptors
│   ├── authService.ts
│   ├── caseService.ts
│   ├── cycleService.ts
│   ├── uploadService.ts
│   └── exportService.ts
├── contexts/
│   ├── AuthContext.tsx
│   ├── CycleContext.tsx
│   └── PermissionsContext.tsx
├── utils/
│   ├── formatters.ts      # Currency, date, percentage formatters
│   ├── validators.ts      # Form validation schemas
│   ├── constants.ts       # App constants
│   └── csvGenerator.ts    # Client-side CSV generation
├── types/
│   ├── api.ts
│   ├── case.ts
│   ├── cycle.ts
│   └── user.ts
├── App.tsx
├── routes.tsx
└── index.tsx
```

---

## Design System (Tailwind Config)

### Color Palette

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',  // Primary blue
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        success: {
          500: '#10b981',
          600: '#059669',
        },
        warning: {
          500: '#f59e0b',
          600: '#d97706',
        },
        danger: {
          500: '#ef4444',
          600: '#dc2626',
        },
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        }
      },
    },
  },
};
```

### Typography Scale

**Headings**:
- H1: `text-3xl font-bold text-gray-900`
- H2: `text-2xl font-semibold text-gray-900`
- H3: `text-xl font-semibold text-gray-800`
- H4: `text-lg font-medium text-gray-800`

**Body**:
- Body Large: `text-base text-gray-700`
- Body: `text-sm text-gray-700`
- Caption: `text-xs text-gray-500`

---

## Component Library

### Button Component

```typescript
// components/common/Button.tsx
import React from 'react';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const variantClasses = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white focus:ring-primary-500 disabled:bg-gray-300',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-900 focus:ring-gray-400 disabled:bg-gray-100',
    danger: 'bg-danger-600 hover:bg-danger-700 text-white focus:ring-danger-500 disabled:bg-gray-300',
    ghost: 'hover:bg-gray-100 text-gray-700 focus:ring-gray-400 disabled:text-gray-400',
  };
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  
  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner className="mr-2 h-4 w-4" />
          <span>Loading...</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="mr-2">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="ml-2">{rightIcon}</span>}
        </>
      )}
    </button>
  );
};
```

**Usage**:
```tsx
<Button variant="primary" size="md" onClick={handleSave}>
  Save Changes
</Button>

<Button variant="danger" isLoading={isDeleting} onClick={handleDelete}>
  Delete
</Button>
```

---

### Badge Component

```typescript
// components/common/Badge.tsx
import React from 'react';

type BadgeVariant = 'draft' | 'in-review' | 'blocked' | 'approved' | 'released' | 'removed' | 'default';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => {
  const variantClasses = {
    draft: 'bg-gray-100 text-gray-700',
    'in-review': 'bg-blue-100 text-blue-700',
    blocked: 'bg-red-100 text-red-700',
    approved: 'bg-green-100 text-green-700',
    released: 'bg-purple-100 text-purple-700',
    removed: 'bg-orange-100 text-orange-700',
    default: 'bg-gray-100 text-gray-700',
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
};
```

**Usage**:
```tsx
<Badge variant="approved">Approved</Badge>
<Badge variant="blocked">Blocked</Badge>
```

---

### Table Component

```typescript
// components/common/Table.tsx
import React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';

interface TableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
}

export function Table<T>({ data, columns, onRowClick }: TableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <div className="flex items-center">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() && (
                      <span className="ml-2">
                        {header.column.getIsSorted() === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className={onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}
            >
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Modal Component

```typescript
// components/common/Modal.tsx
import React, { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-7xl',
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={`w-full ${sizeClasses[size]} transform overflow-hidden rounded-lg bg-white shadow-xl transition-all`}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                    {title}
                  </Dialog.Title>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="px-6 py-4">
                  {children}
                </div>

                {footer && (
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
                    {footer}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};
```

---

## Layout Components

### AppShell

```typescript
// components/layout/AppShell.tsx
import React from 'react';
import { TopNav } from './TopNav';
import { SideNav } from './SideNav';
import { useAuth } from '../../hooks/useAuth';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { user } = useAuth();

  return (
    <div className="h-screen flex overflow-hidden bg-gray-100">
      {/* Side navigation */}
      <SideNav />

      {/* Main content area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav user={user} />
        
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
```

### TopNav

```typescript
// components/layout/TopNav.tsx
import React from 'react';
import { BellIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { CycleSelector } from '../cycles/CycleSelector';
import { Menu } from '@headlessui/react';

interface TopNavProps {
  user: any;
}

export const TopNav: React.FC<TopNavProps> = ({ user }) => {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Cycle selector */}
          <div className="flex-1">
            <CycleSelector />
          </div>

          {/* Right: Notifications and user menu */}
          <div className="flex items-center space-x-4">
            {/* Notifications */}
            <button className="p-2 text-gray-400 hover:text-gray-500 relative">
              <BellIcon className="h-6 w-6" />
              <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            </button>

            {/* User menu */}
            <Menu as="div" className="relative">
              <Menu.Button className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50">
                <UserCircleIcon className="h-8 w-8 text-gray-400" />
                <div className="text-left">
                  <div className="text-sm font-medium text-gray-900">{user?.fullName}</div>
                  <div className="text-xs text-gray-500">{user?.roles?.join(', ')}</div>
                </div>
              </Menu.Button>

              <Menu.Items className="absolute right-0 mt-2 w-48 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                <div className="py-1">
                  <Menu.Item>
                    {({ active }) => (
                      <a
                        href="/profile"
                        className={`${active ? 'bg-gray-100' : ''} block px-4 py-2 text-sm text-gray-700`}
                      >
                        Your Profile
                      </a>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => {/* logout */}}
                        className={`${active ? 'bg-gray-100' : ''} block w-full text-left px-4 py-2 text-sm text-gray-700`}
                      >
                        Sign out
                      </button>
                    )}
                  </Menu.Item>
                </div>
              </Menu.Items>
            </Menu>
          </div>
        </div>
      </div>
    </header>
  );
};
```

### SideNav

```typescript
// components/layout/SideNav.tsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  ArrowUpTrayIcon,
  ChartBarIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';

export const SideNav: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.roles?.includes('ADMIN');

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Cases', href: '/cases', icon: ClipboardDocumentListIcon },
    { name: 'Imports', href: '/imports', icon: ArrowUpTrayIcon },
    { name: 'Cycles', href: '/cycles', icon: ChartBarIcon, adminOnly: true },
    { name: 'Admin', href: '/admin', icon: Cog6ToothIcon, adminOnly: true },
  ];

  return (
    <div className="hidden md:flex md:w-64 md:flex-col">
      <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-primary-700">
        <div className="flex items-center flex-shrink-0 px-4">
          <h1 className="text-xl font-bold text-white">Appraisal Portal</h1>
        </div>
        
        <nav className="mt-8 flex-1 px-2 space-y-1">
          {navigation.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={({ isActive }) =>
                  `group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                    isActive
                      ? 'bg-primary-800 text-white'
                      : 'text-primary-100 hover:bg-primary-600'
                  }`
                }
              >
                <item.icon className="mr-3 h-6 w-6" />
                {item.name}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
```

---

## Page Components

### Dashboard Page

```typescript
// pages/DashboardPage.tsx
import React from 'react';
import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { MetricCard } from '../components/dashboard/MetricCard';
import { CompletionChart } from '../components/dashboard/CompletionChart';
import { BlockersTable } from '../components/dashboard/BlockersTable';
import { useCycle } from '../hooks/useCycles';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboardService';

export const DashboardPage: React.FC = () => {
  const { selectedCycle } = useCycle();
  
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', selectedCycle?.id],
    queryFn: () => dashboardService.getCycleStats(selectedCycle?.id!),
    enabled: !!selectedCycle,
  });

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        subtitle={`Cycle: ${selectedCycle?.name || 'No cycle selected'}`}
      />

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <MetricCard
          title="Total Cases"
          value={stats?.totalCases || 0}
          variant="default"
        />
        <MetricCard
          title="In Review"
          value={stats?.byStatus?.IN_REVIEW || 0}
          variant="info"
        />
        <MetricCard
          title="Blocked"
          value={stats?.byStatus?.BLOCKED || 0}
          variant="danger"
        />
        <MetricCard
          title="Ready for Payroll"
          value={stats?.readyForPayroll || 0}
          variant="success"
        />
      </div>

      {/* Charts and Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CompletionChart cycleId={selectedCycle?.id} />
        <BlockersTable cycleId={selectedCycle?.id} />
      </div>
    </PageContainer>
  );
};
```

### Cases List Page

```typescript
// pages/CasesListPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { CaseFilters } from '../components/cases/CaseFilters';
import { CaseTable } from '../components/cases/CaseTable';
import { Button } from '../components/common/Button';
import { useCases } from '../hooks/useCases';
import { useCycle } from '../hooks/useCycles';

export const CasesListPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedCycle } = useCycle();
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  
  const { data, isLoading } = useCases({
    cycleId: selectedCycle?.id,
    ...filters,
    page,
    limit: 50,
  });

  const handleRowClick = (caseId: string) => {
    navigate(`/cases/${caseId}`);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Appraisal Cases"
        subtitle={`${data?.pagination?.total || 0} cases in ${selectedCycle?.name || 'current cycle'}`}
        actions={
          <Button onClick={() => navigate('/imports')}>
            Upload Data
          </Button>
        }
      />

      <div className="bg-white rounded-lg shadow">
        <CaseFilters filters={filters} onChange={setFilters} />
        
        <CaseTable
          cases={data?.items || []}
          isLoading={isLoading}
          onRowClick={handleRowClick}
        />

        {/* Pagination */}
        {data?.pagination && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Showing {(page - 1) * 50 + 1} to {Math.min(page * 50, data.pagination.total)} of {data.pagination.total} results
            </div>
            <div className="flex space-x-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!data.pagination.hasPreviousPage}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!data.pagination.hasNextPage}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
};
```

### Case Detail Page

```typescript
// pages/CaseDetailPage.tsx
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Tab } from '@headlessui/react';
import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/common/Badge';
import { CompensationDisplay } from '../components/cases/CompensationDisplay';
import { RecommendationCard } from '../components/cases/RecommendationCard';
import { OverrideForm } from '../components/cases/OverrideForm';
import { ApprovalList } from '../components/approvals/ApprovalList';
import { ChecklistProgress } from '../components/cases/ChecklistProgress';
import { AuditTimeline } from '../components/cases/AuditTimeline';
import { useQuery } from '@tanstack/react-query';
import { caseService } from '../services/caseService';

export const CaseDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  
  const { data: caseData, isLoading } = useQuery({
    queryKey: ['case', id],
    queryFn: () => caseService.getCaseById(id!),
    enabled: !!id,
  });

  if (isLoading) return <div>Loading...</div>;
  if (!caseData) return <div>Case not found</div>;

  const tabs = ['Overview', 'Compensation', 'Approvals', 'Checklist', 'Audit Log'];

  return (
    <PageContainer>
      <PageHeader
        title={caseData.fullName}
        subtitle={`${caseData.staffId} • ${caseData.staffRole}`}
        actions={
          <Badge variant={caseData.status.toLowerCase().replace('_', '-')}>
            {caseData.status.replace('_', ' ')}
          </Badge>
        }
      />

      {/* Employee Info Card */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-gray-500">Company</dt>
            <dd className="mt-1 text-sm text-gray-900">{caseData.companyName}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Start Date</dt>
            <dd className="mt-1 text-sm text-gray-900">{caseData.startDate}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Tenure</dt>
            <dd className="mt-1 text-sm text-gray-900">{caseData.tenureDisplay}</dd>
          </div>
        </dl>
      </div>

      {/* Tabbed Content */}
      <Tab.Group>
        <Tab.List className="flex space-x-1 rounded-lg bg-gray-100 p-1 mb-6">
          {tabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `w-full rounded-lg py-2.5 text-sm font-medium leading-5 ${
                  selected
                    ? 'bg-white text-primary-700 shadow'
                    : 'text-gray-700 hover:bg-white/[0.12] hover:text-gray-900'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          <Tab.Panel>
            <div className="space-y-6">
              <CompensationDisplay compensation={caseData.compensation} />
              <RecommendationCard caseId={id!} />
              <OverrideForm caseId={id!} />
            </div>
          </Tab.Panel>

          <Tab.Panel>
            <CompensationDisplay compensation={caseData.compensation} detailed />
          </Tab.Panel>

          <Tab.Panel>
            <ApprovalList caseId={id!} approvals={caseData.approvals} />
          </Tab.Panel>

          <Tab.Panel>
            <ChecklistProgress caseId={id!} items={caseData.checklist} />
          </Tab.Panel>

          <Tab.Panel>
            <AuditTimeline caseId={id!} logs={caseData.movementLogs} />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </PageContainer>
  );
};
```

---

## State Management Patterns

### React Query for Server State

```typescript
// hooks/useCases.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caseService } from '../services/caseService';

export function useCases(filters: any) {
  return useQuery({
    queryKey: ['cases', filters],
    queryFn: () => caseService.getCases(filters),
    keepPreviousData: true,
  });
}

export function useCaseDetail(id: string) {
  return useQuery({
    queryKey: ['case', id],
    queryFn: () => caseService.getCaseById(id),
    enabled: !!id,
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      caseService.updateCase(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries(['case', variables.id]);
      queryClient.invalidateQueries(['cases']);
    },
  });
}
```

### Context for Global State

```typescript
// contexts/CycleContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { cycleService } from '../services/cycleService';

interface CycleContextValue {
  selectedCycle: any | null;
  setSelectedCycle: (cycle: any) => void;
  cycles: any[];
}

const CycleContext = createContext<CycleContextValue | undefined>(undefined);

export const CycleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedCycle, setSelectedCycle] = useState<any | null>(null);
  const [cycles, setCycles] = useState<any[]>([]);

  useEffect(() => {
    // Load active cycles on mount
    cycleService.getCycles({ isActive: true }).then(response => {
      setCycles(response.data.items);
      if (response.data.items.length > 0 && !selectedCycle) {
        setSelectedCycle(response.data.items[0]);
      }
    });
  }, []);

  return (
    <CycleContext.Provider value={{ selectedCycle, setSelectedCycle, cycles }}>
      {children}
    </CycleContext.Provider>
  );
};

export const useCycle = () => {
  const context = useContext(CycleContext);
  if (!context) throw new Error('useCycle must be used within CycleProvider');
  return context;
};
```

---

## Forms and Validation

### React Hook Form + Zod

```typescript
// components/cases/OverrideForm.tsx
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { useUpdateCase } from '../../hooks/useCases';

const overrideSchema = z.object({
  isOverride: z.boolean(),
  overrideReason: z.string().min(10, 'Reason must be at least 10 characters'),
  approvedNewBaseSalary: z.number().positive('Must be a positive number'),
});

type OverrideFormData = z.infer<typeof overrideSchema>;

interface OverrideFormProps {
  caseId: string;
}

export const OverrideForm: React.FC<OverrideFormProps> = ({ caseId }) => {
  const updateCase = useUpdateCase();
  
  const { register, handleSubmit, formState: { errors } } = useForm<OverrideFormData>({
    resolver: zodResolver(overrideSchema),
  });

  const onSubmit = (data: OverrideFormData) => {
    updateCase.mutate({ id: caseId, data });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="flex items-center space-x-2">
          <input type="checkbox" {...register('isOverride')} className="rounded" />
          <span className="text-sm font-medium text-gray-700">Enable Override</span>
        </label>
      </div>

      <Input
        label="Override Reason"
        {...register('overrideReason')}
        error={errors.overrideReason?.message}
        placeholder="Explain why this override is necessary..."
      />

      <Input
        label="Approved New Base Salary"
        type="number"
        step="0.01"
        {...register('approvedNewBaseSalary', { valueAsNumber: true })}
        error={errors.approvedNewBaseSalary?.message}
      />

      <Button type="submit" isLoading={updateCase.isLoading}>
        Save Override
      </Button>
    </form>
  );
};
```

---

## File Upload Component

```typescript
// components/common/FileUpload.tsx
import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  acceptedFileTypes?: string[];
  maxSizeMB?: number;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  acceptedFileTypes = ['.pdf'],
  maxSizeMB = 10,
}) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedFileTypes.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    maxSize: maxSizeMB * 1024 * 1024,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
        isDragActive
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-300 hover:border-gray-400'
      }`}
    >
      <input {...getInputProps()} />
      <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400" />
      <p className="mt-2 text-sm text-gray-600">
        {isDragActive
          ? 'Drop the file here...'
          : 'Drag and drop a file here, or click to select'
        }
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {acceptedFileTypes.join(', ')} up to {maxSizeMB}MB
      </p>
    </div>
  );
};
```

---

## Admin Pages and Features

### Admin: Unmapped Values Page (`/admin/data-flags` or `/admin/unmapped-values`)

Allows administrators to manage contact type values that don't match known mappings detected during intake uploads.

**Layout**:
1. **Status Filter & Summary**:
   - Tabs: `OPEN` | `RESOLVED` | `IGNORED`
   - Summary metrics: "X unmapped values waiting for action"

2. **Unmapped Values Table**:
   - Columns:
     - `Raw Value`: The actual value from the intake file (e.g., "Ops Staff - Manager")
     - `Occurrences`: Count of how many employees have this value (e.g., "5 records")
     - `Last Seen`: Date of last upload batch containing this value
     - `Status`: Badge showing OPEN | RESOLVED | IGNORED
     - `Actions`: Dropdown menu with options
   
3. **Row Actions Dropdown**:
   - **Map Value**: Opens dialog to assign standard mapped output
   - **Ignore**: Mark as ignored (rows stay Unmapped), confirm action
   - **View Details**: Shows sample staff IDs with this value, upload history
   
4. **Mapping Dialog** (triggered by "Map Value"):
   - Dropdown to select mapped output:
     - `Ops Active`
     - `Ops Separated`
     - `Active`
     - `Reprofile`
     - `Floating`
     - `Maternity`
     - `Separated`
     - `Leave`
     - `AU Active`
     - `AU Separated`
   - Checkbox: **"Apply to current cycle data"** (optional, shows only if active cycle exists)
     - When checked: Retroactively update flagged rows in active cycle
     - When unchecked: Mapping applies to future imports only
   - Buttons: `Map` | `Cancel`
   
5. **Audit Trail**:
   - Bottom section shows when mapping was created/resolved
   - Shows admin name who took action
   - Shows "Retroactively applied to X rows in Cycle Y" if applicable

**Key Features**:
- **Non-blocking imports**: Admins can resolve mappings at any time without halting uploads
- **Sealed cycle protection**: Retroactive application is skipped for sealed cycles (immutable guarantee)
- **Batch context**: Shows which upload batches contained the unmapped values
- **Sample data**: On "View Details", displays 3-5 sample employee staff IDs to verify the mapping makes sense

**Example UI for a row**:
```
Raw Value: "Ops Staff - Manager"
Occurrences: 5 records
Last Seen: Feb 25, 2026 3:45 PM
Status: [OPEN badge]
[Actions ▼] → "Map Value" | "Ignore" | "View Details"
```

---

## Performance Optimizations

### Mobile-First Approach

```tsx
// Example responsive grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  <MetricCard />
</div>

// Responsive padding
<div className="px-4 sm:px-6 lg:px-8">
  <PageContent />
</div>

// Hide on mobile, show on desktop
<div className="hidden md:block">
  <SideNav />
</div>

// Mobile menu button
<button className="md:hidden">
  <MenuIcon />
</button>
```

---

## Performance Optimizations

### Code Splitting

```typescript
// routes.tsx
import { lazy, Suspense } from 'react';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CasesListPage = lazy(() => import('./pages/CasesListPage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));

export const routes = [
  {
    path: '/dashboard',
    element: (
      <Suspense fallback={<LoadingSpinner />}>
        <DashboardPage />
      </Suspense>
    ),
  },
];
```

### Memoization

```typescript
// Memo expensive components
export const CaseTable = React.memo(({ cases, onRowClick }) => {
  // ... table rendering
});

// useMemo for expensive calculations
const sortedCases = useMemo(() => {
  return cases.sort((a, b) => a.fullName.localeCompare(b.fullName));
}, [cases]);

// useCallback for stable function references
const handleRowClick = useCallback((caseId: string) => {
  navigate(`/cases/${caseId}`);
}, [navigate]);
```

---

## Accessibility Considerations

- **Semantic HTML**: Use proper heading hierarchy, landmarks
- **Keyboard Navigation**: All interactive elements focusable and operable via keyboard
- **ARIA Labels**: For icon buttons, complex widgets
- **Focus Management**: Trap focus in modals, restore focus on close
- **Color Contrast**: WCAG AA compliant (4.5:1 for normal text)
- **Screen Reader Support**: Announce dynamic changes via aria-live regions

---

This completes the UI Architecture documentation. The frontend is designed to be:
- **Modular**: Reusable components with clear responsibilities
- **Performant**: Code splitting, memoization, virtualization for large lists
- **Accessible**: WCAG AA compliance with keyboard and screen reader support
- **Maintainable**: Consistent patterns, TypeScript types, clear file organization
- **Responsive**: Mobile-first design that scales to desktop

