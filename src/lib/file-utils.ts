// File utility functions for handling signed URLs and file access
// Unified helper for secure file access across the application

import { toast } from '@/hooks/use-toast';
import i18next from 'i18next';

/**
 * Check if a URL is already a signed URL (has token/signature params)
 */
function isSignedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Common signed URL patterns
    return (
      parsed.searchParams.has('token') ||
      parsed.searchParams.has('sig') ||
      parsed.searchParams.has('signature') ||
      parsed.searchParams.has('X-Amz-Signature') ||
      parsed.searchParams.has('sv') // Azure SAS
    );
  } catch {
    return false;
  }
}

/**
 * Check if URL is a Supabase storage URL that needs signing
 */
function isSupabaseStorageUrl(url: string): boolean {
  return (
    url.includes('supabase') && 
    (url.includes('/storage/') || url.includes('/object/'))
  );
}

/**
 * Opens a file URL with signed URL support
 * 
 * - If URL is already signed → opens directly
 * - If URL is external (non-storage) → opens directly  
 * - If URL needs signing → shows placeholder toast with TODO
 * 
 * @param fileUrl - The file URL or storage path
 * @param fileName - Optional filename for display
 * @returns Promise that resolves when action is complete
 */
export async function openSignedUrl(
  fileUrl: string | null | undefined, 
  fileName?: string
): Promise<void> {
  const t = i18next.t.bind(i18next);
  
  if (!fileUrl) {
    toast({
      title: t('files.unavailable', 'Файл недоступен'),
      description: t('files.noUrl', 'URL файла не указан'),
      variant: 'destructive',
    });
    return;
  }

  // Check if it's a full URL
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    // Already signed - open directly
    if (isSignedUrl(fileUrl)) {
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    
    // Supabase storage URL needs signing
    if (isSupabaseStorageUrl(fileUrl)) {
      toast({
        title: t('files.signedUrlRequired', 'Требуется подписанная ссылка'),
        description: t('files.signedUrlTodo', 'Интеграция с /api/files/signed-url в разработке'),
      });
      
      console.info('[openSignedUrl] Storage URL needs signed URL backend:', {
        originalUrl: fileUrl,
        fileName,
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
    title: t('files.signedUrlRequired', 'Требуется подписанная ссылка'),
    description: t('files.signedUrlTodo', 'Интеграция с /api/files/signed-url в разработке'),
  });
  
  console.info('[openSignedUrl] File access requires signed URL backend:', {
    filePath: fileUrl,
    fileName,
    suggestedEndpoint: '/api/files/signed-url?path=' + encodeURIComponent(fileUrl),
  });
}

/**
 * Download a file using signed URL
 * Currently delegates to openSignedUrl
 */
export async function downloadSignedUrl(
  fileUrl: string | null | undefined, 
  fileName?: string
): Promise<void> {
  await openSignedUrl(fileUrl, fileName);
}

/**
 * Get a display-friendly button handler for file access
 * Returns a function suitable for onClick handlers
 */
export function createFileHandler(
  fileUrl: string | null | undefined,
  fileName?: string
): () => void {
  return () => {
    openSignedUrl(fileUrl, fileName);
  };
}
