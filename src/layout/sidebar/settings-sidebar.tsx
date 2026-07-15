/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SidebarFooter } from '@/components/sidebar-footer'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAgentsSettingsHidden } from '@/hooks/use-agents-settings-hidden'
import { ArrowLeft, Bot, Cpu, Plug, Server, SlidersHorizontal, Smartphone, Zap } from 'lucide-react'
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SidebarHeader } from './sidebar-header'

type SettingsSidebarContentProps = {
  onBackClick: () => void
  onSettingsNavigate: (path: string) => void
  /** Test seam — production omits; the hook falls back to `isTauri()`. Lets
   *  tests exercise Tauri Standalone vs. Hosted code paths without mocking
   *  the shared `@/lib/platform` module (which would leak across files —
   *  see `docs/development/testing.md`). */
  isStandalone?: () => boolean
}

export const SettingsSidebarContent = ({
  onBackClick,
  onSettingsNavigate,
  isStandalone,
}: SettingsSidebarContentProps) => {
  const { t } = useTranslation('settings')
  const { toggleSidebar } = useSidebar()
  const location = useLocation()
  const agentsHidden = useAgentsSettingsHidden({ isStandalone })

  return (
    <SidebarContent className="flex flex-col h-full">
      <SidebarHeader onToggle={toggleSidebar} />

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onBackClick} tooltip={t('sidebar.backToChat')} className="cursor-pointer">
                <ArrowLeft className="size-4" />
                <span>{t('common:back')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator className="m-0" />

      <SidebarGroup className="flex-1">
        <SidebarGroupLabel>{t('sidebar.title')}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSettingsNavigate('/settings/preferences')}
                tooltip={t('preferences.title')}
                className="cursor-pointer"
                isActive={location.pathname === '/settings/preferences'}
              >
                <SlidersHorizontal className="size-4" />
                <span>{t('preferences.title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSettingsNavigate('/settings/integrations')}
                tooltip={t('integrations.title')}
                className="cursor-pointer"
                isActive={location.pathname === '/settings/integrations'}
              >
                <Plug className="size-4" />
                <span>{t('integrations.title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSettingsNavigate('/settings/devices')}
                tooltip={t('devices.title')}
                className="cursor-pointer"
                isActive={location.pathname === '/settings/devices'}
              >
                <Smartphone className="size-4" />
                <span>{t('devices.title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSettingsNavigate('/settings/models')}
                tooltip={t('models.title')}
                className="cursor-pointer"
                isActive={location.pathname.startsWith('/settings/models')}
              >
                <Cpu className="size-4" />
                <span>{t('models.title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSettingsNavigate('/settings/mcp-servers')}
                tooltip={t('mcpServers.title')}
                className="cursor-pointer"
                isActive={location.pathname === '/settings/mcp-servers'}
              >
                <Server className="size-4" />
                <span>{t('mcpServers.title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => onSettingsNavigate('/settings/skills')}
                tooltip={t('skills.title')}
                className="cursor-pointer"
                isActive={location.pathname === '/settings/skills'}
              >
                <Zap className="size-4" />
                <span>{t('skills.title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {!agentsHidden && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => onSettingsNavigate('/settings/agents')}
                  tooltip={t('agents.title')}
                  className="cursor-pointer"
                  isActive={location.pathname === '/settings/agents'}
                >
                  <Bot className="size-4" />
                  <span>{t('agents.title')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarFooter />
    </SidebarContent>
  )
}
