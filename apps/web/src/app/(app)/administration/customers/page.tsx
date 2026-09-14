import type { Metadata } from 'next';
import { CustomersView } from '@/features/customers/customers-view';

export const metadata: Metadata = { title: 'Customers & brands' };

export default function CustomersPage() {
  return <CustomersView />;
}
