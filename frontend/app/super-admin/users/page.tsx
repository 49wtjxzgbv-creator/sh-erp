'use client';

import { useEffect, useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { superAdminApi } from '@/lib/super-admin/api';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  createdAt: string;
  memberships: { companyId: string; company: { name: string; slug: string } }[];
}

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const res = await superAdminApi.get<{ items: UserRow[] }>(
      `super-admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    );
    setUsers(res.items);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users</h1>
      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">Every user on the platform, across all companies</CardTitle>
          <div className="pt-2">
            <Input
              placeholder="Search by email or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs bg-slate-950"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Full name</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.fullName}</TableCell>
                  <TableCell className="text-slate-400">
                    {u.memberships.map((m) => m.company.name).join(', ') || '—'}
                  </TableCell>
                  <TableCell>{u.active ? 'Yes' : 'No'}</TableCell>
                  <TableCell className="text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
