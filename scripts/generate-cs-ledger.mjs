import fs from 'node:fs';

const ledger = JSON.parse(fs.readFileSync('migration-ledger.json', 'utf8'));

let csharp = 'namespace Klip.Services;\n\npublic static class CloudflareMigrationLedger\n{\n';
csharp += '    public record MigratedMedia(string PlaybackUrl, string ThumbnailUrl);\n\n';
csharp += '    private static readonly Dictionary<string, MigratedMedia> Entries = new(StringComparer.OrdinalIgnoreCase)\n    {\n';

for (const [id, item] of Object.entries(ledger.migrated)) {
  csharp += `        ["${id}"] = new MigratedMedia("${item.playbackUrl}", "${item.thumbnailUrl}"),\n`;
}

csharp += '    };\n\n';
csharp += `    public static string ResolvePlaybackUrl(string? klipId, string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl) && string.IsNullOrWhiteSpace(klipId))
            return string.Empty;

        if (!string.IsNullOrWhiteSpace(rawUrl) && rawUrl.Contains("cloudflarestream.com", StringComparison.OrdinalIgnoreCase))
            return rawUrl;

        if (!string.IsNullOrWhiteSpace(klipId) && Entries.TryGetValue(klipId, out var m))
            return m.PlaybackUrl;

        return rawUrl ?? string.Empty;
    }

    public static string ResolveThumbnailUrl(string? klipId, string? rawUrl, string? rawThumbnailUrl)
    {
        if (!string.IsNullOrWhiteSpace(rawThumbnailUrl))
            return rawThumbnailUrl;

        if (!string.IsNullOrWhiteSpace(klipId) && Entries.TryGetValue(klipId, out var m))
            return m.ThumbnailUrl;

        if (!string.IsNullOrWhiteSpace(rawUrl) && rawUrl.Contains("cloudflarestream.com", StringComparison.OrdinalIgnoreCase))
        {
            var match = System.Text.RegularExpressions.Regex.Match(rawUrl, @"cloudflarestream\.com/([a-zA-Z0-9]+)");
            if (match.Success)
            {
                return $"https://customer-wmucbvx0oqk5mob1.cloudflarestream.com/{match.Groups[1].Value}/thumbnails/thumbnail.jpg";
            }
        }

        return string.Empty;
    }

    public static string ResolveAvatarUrl(string? uid, string? rawAvatarUrl)
    {
        if (string.IsNullOrWhiteSpace(rawAvatarUrl))
            return string.Empty;

        if (rawAvatarUrl.Contains("videos.kliponline.com", StringComparison.OrdinalIgnoreCase))
            return rawAvatarUrl;

        // If it points to Firebase Storage, route to R2 custom domain
        if (rawAvatarUrl.Contains("firebasestorage", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(uid))
        {
            return $"https://videos.kliponline.com/avatars/{uid}.jpg";
        }

        return rawAvatarUrl;
    }

    public static string[] ResolvePhotoUrls(string? klipId, string[]? photos)
    {
        if (photos is null || photos.Length == 0)
            return [];

        var resolved = new string[photos.Length];
        for (int i = 0; i < photos.Length; i++)
        {
            string url = photos[i];
            if (url.Contains("videos.kliponline.com", StringComparison.OrdinalIgnoreCase))
            {
                resolved[i] = url;
            }
            else if (url.Contains("firebasestorage", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(klipId))
            {
                resolved[i] = $"https://videos.kliponline.com/klip_photos/{klipId}_{i}.jpg";
            }
            else
            {
                resolved[i] = url;
            }
        }
        return resolved;
    }
}
`;

fs.writeFileSync('c:/Users/ilanl/Downloads/Klip/Services/CloudflareMigrationLedger.cs', csharp);
console.log('Successfully wrote CloudflareMigrationLedger.cs with', Object.keys(ledger.migrated).length, 'entries.');

