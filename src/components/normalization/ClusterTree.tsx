/**
 * ClusterTree v2 — Redesigned hierarchical cluster navigation
 * 
 * Hierarchy: profile → thickness_mm → coating → color_or_ral
 * Clean card-style layout with progress indicators
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  ChevronRight, ChevronDown, Sparkles, AlertCircle, CheckCircle2,
  Layers, Package
} from 'lucide-react';
import type { ClusterNode, ClusterPath, CanonicalProduct, NormalizationStatus } from './types';
import { validateProduct } from './types';

interface ClusterTreeProps {
  items: CanonicalProduct[];
  selectedCluster: ClusterPath | null;
  onSelectCluster: (path: ClusterPath) => void;
  expandedNodes: Set<string>;
  onToggleNode: (nodeId: string) => void;
}

// ─── Build Tree ─────────────────────────────────────────────

function buildClusterTree(items: CanonicalProduct[]): ClusterNode[] {
  const profileGroups = new Map<string, CanonicalProduct[]>();
  
  items.forEach(item => {
    const profile = item.profile || '⚠ Без профиля';
    if (!profileGroups.has(profile)) profileGroups.set(profile, []);
    profileGroups.get(profile)!.push(item);
  });
  
  const nodes: ClusterNode[] = [];
  
  profileGroups.forEach((profileItems, profile) => {
    // Count ready/attention
    let ready = 0, attention = 0;
    profileItems.forEach(item => {
      if (validateProduct(item).status === 'ready') ready++;
      else attention++;
    });

    // Build thickness children
    const thicknessGroups = new Map<string, CanonicalProduct[]>();
    profileItems.forEach(item => {
      const t = item.thickness_mm ? `${item.thickness_mm}` : '⚠';
      if (!thicknessGroups.has(t)) thicknessGroups.set(t, []);
      thicknessGroups.get(t)!.push(item);
    });

    const children: ClusterNode[] = [];
    thicknessGroups.forEach((tItems, thickness) => {
      let tReady = 0, tAttention = 0;
      tItems.forEach(i => {
        if (validateProduct(i).status === 'ready') tReady++; else tAttention++;
      });

      // Build coating children under thickness
      const coatingGroups = new Map<string, CanonicalProduct[]>();
      tItems.forEach(item => {
        const c = item.coating || '⚠';
        if (!coatingGroups.has(c)) coatingGroups.set(c, []);
        coatingGroups.get(c)!.push(item);
      });

      const coatingChildren: ClusterNode[] = [];
      coatingGroups.forEach((cItems, coating) => {
        let cReady = 0, cAttention = 0;
        cItems.forEach(i => {
          if (validateProduct(i).status === 'ready') cReady++; else cAttention++;
        });
        coatingChildren.push({
          id: `coat:${profile}:${thickness}:${coating}`,
          level: 'coating',
          value: coating,
          display_label: coating === '⚠' ? 'Без покрытия' : coating,
          items_count: cItems.length,
          ready_count: cReady,
          needs_attention_count: cAttention,
        });
      });

      coatingChildren.sort((a, b) => b.needs_attention_count - a.needs_attention_count || b.items_count - a.items_count);

      children.push({
        id: `thick:${profile}:${thickness}`,
        level: 'thickness',
        value: thickness,
        display_label: thickness === '⚠' ? 'Без толщины' : `${thickness} мм`,
        items_count: tItems.length,
        ready_count: tReady,
        needs_attention_count: tAttention,
        children: coatingChildren.length > 1 ? coatingChildren : undefined,
      });
    });

    children.sort((a, b) => b.needs_attention_count - a.needs_attention_count || b.items_count - a.items_count);

    nodes.push({
      id: `prof:${profile}`,
      level: 'profile',
      value: profile,
      display_label: profile,
      items_count: profileItems.length,
      ready_count: ready,
      needs_attention_count: attention,
      children: children.length > 0 ? children : undefined,
    });
  });
  
  // Sort: problems first, then by count
  nodes.sort((a, b) => {
    if (b.needs_attention_count !== a.needs_attention_count) return b.needs_attention_count - a.needs_attention_count;
    return b.items_count - a.items_count;
  });
  
  return nodes;
}

// ─── Compact Progress Bar ───────────────────────────────────

function MiniProgress({ ready, total }: { ready: number; total: number }) {
  const pct = total > 0 ? (ready / total) * 100 : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct === 100 ? "bg-green-500" : pct > 50 ? "bg-primary" : "bg-destructive"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">{ready}/{total}</span>
    </div>
  );
}

// ─── Tree Node ──────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  selectedCluster,
  onSelectCluster,
  expandedNodes,
  onToggleNode,
  parentPath,
}: {
  node: ClusterNode;
  depth: number;
  selectedCluster: ClusterPath | null;
  onSelectCluster: (path: ClusterPath) => void;
  expandedNodes: Set<string>;
  onToggleNode: (nodeId: string) => void;
  parentPath: ClusterPath;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  
  const nodePath: ClusterPath = { ...parentPath };
  switch (node.level) {
    case 'profile': nodePath.profile = node.value; break;
    case 'thickness': nodePath.thickness_mm = parseFloat(node.value) || undefined; break;
    case 'coating': nodePath.coating = node.value; break;
    case 'color': nodePath.color_or_ral = node.value; break;
  }
  
  const isSelected = selectedCluster &&
    nodePath.profile === selectedCluster.profile &&
    nodePath.thickness_mm === selectedCluster.thickness_mm &&
    nodePath.coating === selectedCluster.coating &&
    nodePath.color_or_ral === selectedCluster.color_or_ral;
  
  const handleClick = () => {
    onSelectCluster(nodePath);
    // Auto-expand on click
    if (hasChildren && !isExpanded) onToggleNode(node.id);
  };
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleNode(node.id);
  };
  
  const isWarning = node.value.startsWith('⚠');
  const isProfileLevel = node.level === 'profile';
  
  return (
    <div className={cn(depth === 0 && "mb-1")}>
      <button
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-1.5 rounded-md text-left transition-all",
          isProfileLevel ? "px-2.5 py-2" : "px-2 py-1",
          isSelected
            ? "bg-primary/10 border border-primary/30 text-primary"
            : "hover:bg-accent/50 border border-transparent",
          isWarning && !isSelected && "text-destructive/80",
        )}
        style={{ marginLeft: `${depth * 12}px` }}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <button onClick={handleToggle} className="p-0.5 hover:bg-accent rounded shrink-0">
            {isExpanded
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />
            }
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        
        {/* Status dot */}
        <span className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          node.needs_attention_count === 0 ? "bg-green-500" : 
          node.ready_count === 0 ? "bg-destructive" : "bg-amber-500"
        )} />
        
        {/* Label */}
        <span className={cn(
          "truncate flex-1",
          isProfileLevel ? "text-xs font-semibold" : "text-[11px]",
        )}>
          {node.display_label}
        </span>
        
        {/* Progress */}
        {isProfileLevel ? (
          <MiniProgress ready={node.ready_count} total={node.items_count} />
        ) : (
          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
            {node.items_count}
          </span>
        )}
      </button>
      
      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {node.children!.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedCluster={selectedCluster}
              onSelectCluster={onSelectCluster}
              expandedNodes={expandedNodes}
              onToggleNode={onToggleNode}
              parentPath={nodePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function ClusterTree({
  items,
  selectedCluster,
  onSelectCluster,
  expandedNodes,
  onToggleNode,
}: ClusterTreeProps) {
  const { t } = useTranslation();
  
  const tree = useMemo(() => buildClusterTree(items), [items]);
  
  const totalReady = tree.reduce((sum, n) => sum + n.ready_count, 0);
  const totalAttention = tree.reduce((sum, n) => sum + n.needs_attention_count, 0);
  const total = totalReady + totalAttention;
  const pct = total > 0 ? Math.round((totalReady / total) * 100) : 0;
  
  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">{t('normalize.noClusters', 'Нет данных для кластеризации')}</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Summary Header */}
      <div className="px-3 py-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold text-xs">{t('normalize.clusters', 'Кластеры')}</span>
          </div>
          <span className="text-xs font-bold text-primary">{pct}%</span>
        </div>
        
        <Progress value={pct} className="h-1.5" />
        
        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            <span className="text-green-700 font-medium">{totalReady} готово</span>
          </div>
          {totalAttention > 0 && (
            <div className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-destructive" />
              <span className="text-destructive font-medium">{totalAttention} проблем</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {tree.map(node => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              selectedCluster={selectedCluster}
              onSelectCluster={onSelectCluster}
              expandedNodes={expandedNodes}
              onToggleNode={onToggleNode}
              parentPath={{}}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
