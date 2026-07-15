/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useDatabase } from '@/contexts'
import { getAllDevices, getPendingDevices } from '@/dal'
import { getDeviceId } from '@/lib/auth-token'
import { PageHeader } from '@/components/ui/page-header'
import { ApproveDeviceDialog } from '@/components/approve-device-dialog'
import { RevokeDeviceDialog } from '@/components/revoke-device-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import dayjs from 'dayjs'
import { SectionCard } from '@/components/ui/section-card'
import { CheckCircle2, Link2, Loader2, QrCode, Smartphone, Trash2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@powersync/tanstack-react-query'
import { toCompilableQuery } from '@powersync/drizzle-driver'
import { useApproveDevice } from '@/hooks/use-approve-device'
import { useDenyDevice } from '@/hooks/use-deny-device'
import { useRevokeDevice } from '@/hooks/use-revoke-device'
import { useSetDeviceNodeId } from '@/hooks/use-set-device-node-id'
import { useDevicePairing } from '@/hooks/use-device-pairing'
import { encodePairingTicket } from '@/lib/pairing-ticket'

const DeviceQrCode = lazy(() => import('@/components/device-qr-code'))
const SetNodeIdDialog = lazy(() => import('@/components/set-node-id-dialog'))

const formatLastSeen = (ts: string | null): string => {
  if (ts == null) {
    return '—'
  }
  const date = dayjs(ts)
  const now = dayjs()
  const diffMs = date.diff(now)
  return dayjs.duration(diffMs, 'millisecond').humanize(true)
}

export default function DevicesSettingsPage() {
  const { t } = useTranslation('settings')
  const db = useDatabase()
  const currentDeviceId = getDeviceId()
  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    query: toCompilableQuery(getAllDevices(db)),
  })
  const { data: pendingDevices = [] } = useQuery({
    queryKey: ['pending-devices'],
    query: toCompilableQuery(getPendingDevices(db)),
  })
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)
  const [denyTarget, setDenyTarget] = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<string | null>(null)

  const visibleDevices = devices.filter((d) => {
    if (d.revokedAt != null) {
      return dayjs().diff(dayjs(d.revokedAt), 'hour') < 24
    }
    return !!d.trusted
  })

  const revokeMutation = useRevokeDevice()
  const denyMutation = useDenyDevice()
  const approveMutation = useApproveDevice(pendingDevices)
  const setNodeIdMutation = useSetDeviceNodeId()
  const pairing = useDevicePairing()

  const dialogDevice = devices.find((d) => d.id === pairing.dialogFor) ?? null

  const confirmSetNodeId = async (nodeId: string) => {
    if (!pairing.dialogFor) {
      return
    }
    await setNodeIdMutation.mutateAsync({ deviceId: pairing.dialogFor, nodeId })
    pairing.closeDialog()
  }

  const confirmRevoke = () => {
    if (revokeTarget) {
      revokeMutation.mutate(revokeTarget, {
        onSuccess: () => setRevokeTarget(null),
      })
    }
  }

  const confirmDeny = () => {
    if (denyTarget) {
      denyMutation.mutate(denyTarget, {
        onSuccess: () => setDenyTarget(null),
      })
    }
  }

  const confirmApprove = () => {
    if (approveTarget) {
      approveMutation.mutate(approveTarget, {
        onSuccess: () => setApproveTarget(null),
      })
    }
  }

  const hasPendingDevices = pendingDevices.length > 0

  return (
    <div className="flex flex-col gap-6 p-4 pb-12 w-full max-w-[760px] mx-auto">
      <PageHeader title={t('devices.title')} />

      {hasPendingDevices && (
        <>
          <SectionCard title={t('devices.pendingApprovalsTitle')}>
            <div className="flex flex-col gap-3">
              {pendingDevices.map((device) => (
                <Card key={device.id} className="bg-secondary/50">
                  <CardContent>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium truncate">{device.name}</span>
                          <p className="text-sm text-muted-foreground">{t('devices.waitingForApproval')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDenyTarget(device.id)}
                          disabled={denyMutation.isPending}
                        >
                          <Trash2 className="size-4 mr-1" />
                          {t('devices.deny')}
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setApproveTarget(device.id)}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending && approveMutation.variables === device.id ? (
                            <Loader2 className="size-4 mr-1 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-4 mr-1" />
                          )}
                          {t('devices.approve')}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </SectionCard>

          <div className="h-px bg-border" />
        </>
      )}

      {hasPendingDevices && <h3 className="text-lg font-semibold -mb-2">{t('devices.trustedDevicesTitle')}</h3>}

      {isLoading ? (
        <p className="text-muted-foreground py-4">{t('devices.loading')}</p>
      ) : visibleDevices.length === 0 ? (
        <p className="text-muted-foreground py-4">{t('devices.emptyDescription')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleDevices.map((device) => {
            const isCurrent = device.id === currentDeviceId
            const isRevoked = device.revokedAt != null
            return (
              <Card key={device.id}>
                <CardContent>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium truncate">{device.name}</span>
                          {isCurrent && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                              {t('devices.thisDevice')}
                            </span>
                          )}
                          {isRevoked && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                              {t('devices.revoked')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t('devices.lastSeen', { value: formatLastSeen(device.lastSeen) })}
                        </p>
                      </div>
                    </div>
                    {!isRevoked && !isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTarget(device.id)}
                        disabled={revokeMutation.isPending}
                      >
                        <Trash2 className="size-4 mr-1" />
                        {t('devices.revoke')}
                      </Button>
                    )}
                  </div>

                  {!isRevoked && (
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link2 className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono text-[length:var(--font-size-xs)] text-muted-foreground">
                            {device.nodeId ? device.nodeId : t('devices.noPairingIdentity')}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {device.nodeId && (
                            <Button variant="ghost" size="sm" onClick={() => pairing.toggleQr(device.id)}>
                              <QrCode className="size-4 mr-1" />
                              {pairing.qrFor === device.id ? t('devices.hide') : t('devices.show')}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => pairing.openDialog(device.id)}>
                            {device.nodeId ? t('devices.update') : t('devices.setNodeId')}
                          </Button>
                        </div>
                      </div>
                      {device.nodeId && pairing.qrFor === device.id && (
                        <Suspense
                          fallback={
                            <p className="text-[length:var(--font-size-xs)] text-muted-foreground">
                              {t('devices.loadingCode')}
                            </p>
                          }
                        >
                          <DeviceQrCode value={encodePairingTicket({ nodeId: device.nodeId, name: device.name })} />
                        </Suspense>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ApproveDeviceDialog
        open={approveTarget !== null}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        onConfirm={confirmApprove}
        isPending={approveMutation.isPending}
      />

      <RevokeDeviceDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        isPending={revokeMutation.isPending}
        variant="trusted"
      />

      <RevokeDeviceDialog
        open={denyTarget !== null}
        onOpenChange={(open) => !open && setDenyTarget(null)}
        onConfirm={confirmDeny}
        isPending={denyMutation.isPending}
        variant="pending"
      />

      {dialogDevice && (
        <Suspense fallback={null}>
          <SetNodeIdDialog
            key={dialogDevice.id}
            open
            onOpenChange={(open) => !open && pairing.closeDialog()}
            deviceName={dialogDevice.name}
            onConfirm={confirmSetNodeId}
            isPending={setNodeIdMutation.isPending}
          />
        </Suspense>
      )}
    </div>
  )
}
