package com.playd.music.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val PlaydColorScheme = darkColorScheme(
    primary = Color(0xFF6366F1),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF4F46E5),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFF818CF8),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFF3730A3),
    onSecondaryContainer = Color.White,
    tertiary = Color(0xFFA78BFA),
    background = Color(0xFF0A0A0A),
    onBackground = Color(0xFFFFFFFF),
    surface = Color(0xFF141414),
    onSurface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFF1E1E1E),
    onSurfaceVariant = Color(0xFFB0B0B0),
    outline = Color(0xFF333333),
    error = Color(0xFFEF4444),
    onError = Color.White,
)

private val PlaydTypography = Typography(
    headlineLarge = Typography().headlineLarge.copy(color = Color.White),
    headlineMedium = Typography().headlineMedium.copy(color = Color.White),
    headlineSmall = Typography().headlineSmall.copy(color = Color.White),
    titleLarge = Typography().titleLarge.copy(color = Color.White),
    titleMedium = Typography().titleMedium.copy(color = Color.White),
    titleSmall = Typography().titleSmall.copy(color = Color(0xFFB0B0B0)),
    bodyLarge = Typography().bodyLarge.copy(color = Color(0xFFCCCCCC)),
    bodyMedium = Typography().bodyMedium.copy(color = Color(0xFFAAAAAA)),
    bodySmall = Typography().bodySmall.copy(color = Color(0xFF888888)),
    labelLarge = Typography().labelLarge.copy(color = Color(0xFFAAAAAA)),
    labelMedium = Typography().labelMedium.copy(color = Color(0xFF888888)),
    labelSmall = Typography().labelSmall.copy(color = Color(0xFF666666)),
)

@Composable
fun PlaydTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PlaydColorScheme,
        typography = PlaydTypography,
        content = content
    )
}
