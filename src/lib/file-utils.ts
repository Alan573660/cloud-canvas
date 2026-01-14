// File utility functions for handling signed URLs and file access
// TODO: Replace with actual signed URL endpoint when backend is ready

import { toast } from '@/hooks/use-toast';

/**
 * Opens a file URL with signed URL support
 * Currently a placeholder that shows a TODO message
 * In production: call /api/files/signed-url?path=... to get a signed URL
 */
export async function openSignedUrl(fileUrl: string | null | undefined, fileName?: string): Promise<void> {
  if (!fileUrl) {
    toast({
      title: 'Файл недоступен',
      description: 'URL файла не указан',
      variant: 'destructive',
    });
    return;
  }

  // Check if it's an external URL (http/https) - these don't need signing
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    // For now, show a placeholder message for storage URLs
    // In production, check if it's a Supabase storage URL and get signed URL
    if (fileUrl.includes('supabase') || fileUrl.includes('storage')) {
      toast({
        title: 'Требуется signed URL',
        description: 'TODO: Интегрируйте endpoint /api/files/signed-url для безопасного доступа к файлам',
      });
      console.info('[openSignedUrl] Needs signed URL backend:', {
        originalUrl: fileUrl,
        suggestedEndpoint: '/api/files/signed-url?path=' + encodeURIComponent(fileUrl),
      });
      return;
    }
    
    // External URL - open directly
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  // Internal storage path - needs signed URL
  toast({
    title: 'Требуется signed URL',
    description: 'TODO: Интегрируйте endpoint /api/files/signed-url для безопасного доступа к файлам',
  });
  
  console.info('[openSignedUrl] File access requires signed URL backend:', {
    filePath: fileUrl,
    fileName,
    suggestedEndpoint: '/api/files/signed-url?path=' + encodeURIComponent(fileUrl),
  });
}

/**
 * Download a file using signed URL
 * Placeholder for future implementation
 */
export async function downloadSignedUrl(fileUrl: string | null | undefined, fileName?: string): Promise<void> {
  await openSignedUrl(fileUrl, fileName);
}
