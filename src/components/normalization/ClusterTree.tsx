/**
 * ClusterTree - Иерархическое дерево кластеров
 * 
 * Иерархия: product_type → profile → thickness_mm → coating → color_or_ral
 * Кластеры группируют товары для массового редактирования
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ChevronRight, ChevronDown, Sparkles, AlertCircle, CheckCircle2
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

// =========================================
// Build Cluster Tree from Items
// =========================================
function buildClusterTree(items: CanonicalProduct[]): ClusterNode[] {
  // Group by profile
  const profileGroups = new Map<string, CanonicalProduct[]>();
  
  items.forEach(item => {
    const profile = item.profile || '—';
    if (!profileGroups.has(profile)) {
      profileGroups.set(profile, []);
    }
    profileGroups.get(profile)!.push(item);
  });
  
  // Build tree nodes
  const nodes: ClusterNode[] = [];
  
  profileGroups.forEach((profileItems, profile) => {
    const profileNode = buildProfileNode(profile, profileItems);
    nodes.push(profileNode);
  });
  
  // Sort by needs_attention_count DESC, then by items_count DESC
  nodes.sort((a, b) => {
    if (b.needs_attention_count !== a.needs_attention_count) {
      return b.needs_attention_count - a.needs_attention_count;
    }
    return b.items_count - a.items_count;
  });
  
  return nodes;
}

function buildProfileNode(profile: string, items: CanonicalProduct[]): ClusterNode {
  // Group by thickness
  const thicknessGroups = new Map<string, CanonicalProduct[]>();
  
  items.forEach(item => {
    const thickness = item.thickness_mm?.toString() || '—';
    if (!thicknessGroups.has(thickness)) {
      thicknessGroups.set(thickness, []);
    }
    thicknessGroups.get(thickness)!.push(item);
  });
  
  const children: ClusterNode[] = [];
  let totalReady = 0;
  let totalNeedsAttention = 0;
  
  thicknessGroups.forEach((thicknessItems, thickness) => {
    const thicknessNode = buildThicknessNode(profile, thickness, thicknessItems);
    children.push(thicknessNode);
    totalReady += thicknessNode.ready_count;
    totalNeedsAttention += thicknessNode.needs_attention_count;
  });
  
  // Sort children
  children.sort((a, b) => b.needs_attention_count - a.needs_attention_count);
  
  return {
    id: `profile:${profile}`,
    level: 'profile',
    value: profile,
    display_label: profile,
    items_count: items.length,
    ready_count: totalReady,
    needs_attention_count: totalNeedsAttention,
    children,
  };
}

function buildThicknessNode(profile: string, thickness: string, items: CanonicalProduct[]): ClusterNode {
  // Group by coating
  const coatingGroups = new Map<string, CanonicalProduct[]>();
  
  items.forEach(item => {
    const coating = item.coating || '—';
    if (!coatingGroups.has(coating)) {
      coatingGroups.set(coating, []);
    }
    coatingGroups.get(coating)!.push(item);
  });
  
  const children: ClusterNode[] = [];
  let totalReady = 0;
  let totalNeedsAttention = 0;
  
  coatingGroups.forEach((coatingItems, coating) => {
    const coatingNode = buildCoatingNode(profile, thickness, coating, coatingItems);
    children.push(coatingNode);
    totalReady += coatingNode.ready_count;
    totalNeedsAttention += coatingNode.needs_attention_count;
  });
  
  children.sort((a, b) => b.needs_attention_count - a.needs_attention_count);
  
  return {
    id: `thickness:${profile}:${thickness}`,
    level: 'thickness',
    value: thickness,
    display_label: thickness === '—' ? '— мм' : `${thickness} мм`,
    items_count: items.length,
    ready_count: totalReady,
    needs_attention_count: totalNeedsAttention,
    children,
  };
}

function buildCoatingNode(profile: string, thickness: string, coating: string, items: CanonicalProduct[]): ClusterNode {
  // Group by color
  const colorGroups = new Map<string, CanonicalProduct[]>();
  
  items.forEach(item => {
    const color = item.color_or_ral || '—';
    if (!colorGroups.has(color)) {
      colorGroups.set(color, []);
    }
    colorGroups.get(color)!.push(item);
  });
  
  const children: ClusterNode[] = [];
  let totalReady = 0;
  let totalNeedsAttention = 0;
  
  colorGroups.forEach((colorItems, color) => {
    // Validate each item in color group
    let ready = 0;
    let needsAttention = 0;
    colorItems.forEach(item => {
      const validation = validateProduct(item);
      if (validation.status === 'ready') ready++;
      else needsAttention++;
    });
    
    totalReady += ready;
    totalNeedsAttention += needsAttention;
    
    children.push({
      id: `color:${profile}:${thickness}:${coating}:${color}`,
      level: 'color',
      value: color,
      display_label: color,
      items_count: colorItems.length,
      ready_count: ready,
      needs_attention_count: needsAttention,
    });
  });
  
  children.sort((a, b) => b.needs_attention_count - a.needs_attention_count);
  
  return {
    id: `coating:${profile}:${thickness}:${coating}`,
    level: 'coating',
    value: coating,
    display_label: coating,
    items_count: items.length,
    ready_count: totalReady,
    needs_attention_count: totalNeedsAttention,
    children,
  };
}

// =========================================
// Tree Node Component
// =========================================
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
  
  // Build path for this node
  const nodePath: ClusterPath = { ...parentPath };
  switch (node.level) {
    case 'profile':
      nodePath.profile = node.value;
      break;
    case 'thickness':
      nodePath.thickness_mm = parseFloat(node.value) || undefined;
      break;
    case 'coating':
      nodePath.coating = node.value;
      break;
    case 'color':
      nodePath.color_or_ral = node.value;
      break;
  }
  
  // Check if this node matches selected cluster
  const isSelected = selectedCluster && 
    nodePath.profile === selectedCluster.profile &&
    nodePath.thickness_mm === selectedCluster.thickness_mm &&
    nodePath.coating === selectedCluster.coating &&
    nodePath.color_or_ral === selectedCluster.color_or_ral;
  
  const handleClick = () => {
    onSelectCluster(nodePath);
  };
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleNode(node.id);
  };
  
  const status: NormalizationStatus = node.needs_attention_count > 0 ? 'needs_attention' : 'ready';
  
  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors",
          "hover:bg-accent/50",
          isSelected && "bg-primary/10 text-primary font-medium"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/Collapse */}
        {hasChildren ? (
          <button
            onClick={handleToggle}
            className="p-0.5 hover:bg-accent rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        
        {/* Status Icon */}
        {status === 'ready' ? (
          <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
        ) : (
          <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
        )}
        
        {/* Label */}
        <span className="truncate flex-1">{node.display_label}</span>
        
        {/* Count */}
        <span className="text-xs text-muted-foreground shrink-0">
          {node.items_count}
        </span>
        
        {/* AI Suggestion Badge */}
        {node.ai_suggestion && (
          <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-purple-50 text-purple-700">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            AI
          </Badge>
        )}
      </button>
      
      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
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

// =========================================
// Main Component
// =========================================
export function ClusterTree({
  items,
  selectedCluster,
  onSelectCluster,
  expandedNodes,
  onToggleNode,
}: ClusterTreeProps) {
  const { t } = useTranslation();
  
  const tree = useMemo(() => buildClusterTree(items), [items]);
  
  // Calculate totals
  const totalReady = tree.reduce((sum, n) => sum + n.ready_count, 0);
  const totalNeedsAttention = tree.reduce((sum, n) => sum + n.needs_attention_count, 0);
  
  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p className="text-sm">{t('normalize.noClusters', 'Нет данных для кластеризации')}</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">
          {t('normalize.clusters', 'Кластеры')}
        </h3>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex items-center gap-1 text-xs">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            <span className="text-green-700">{totalReady}</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <AlertCircle className="h-3 w-3 text-red-500" />
            <span className="text-red-600">{totalNeedsAttention}</span>
          </div>
        </div>
      </div>
      
      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-2">
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
