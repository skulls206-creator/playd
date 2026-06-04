package com.playd.music

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.playd.music.data.MusicRepository
import com.playd.music.data.SortOrder
import com.playd.music.data.Track
import com.playd.music.player.MusicPlayerService
import com.playd.music.player.PlayerManager
import com.playd.music.ui.components.MiniPlayer
import com.playd.music.ui.screens.LibraryScreen
import com.playd.music.ui.screens.NowPlayingScreen
import com.playd.music.ui.screens.QueueScreen
import com.playd.music.ui.theme.PlaydTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private var musicService: MusicPlayerService? = null
    private var isBound = false
    private var playerManager: PlayerManager? = null
    private var repository: MusicRepository? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as MusicPlayerService.LocalBinder
            musicService = binder.getService()
            playerManager = musicService!!.playerManager
            isBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            musicService = null
            playerManager = null
            isBound = false
        }
    }

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (allGranted) {
            repository?.let { repo ->
                lifecycleScope.launch {
                    repo.scanMediaStore()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        repository = MusicRepository.getInstance(this)

        // Start and bind to the player service
        val serviceIntent = Intent(this, MusicPlayerService::class.java)
        startForegroundService(serviceIntent)
        bindService(serviceIntent, serviceConnection, BIND_AUTO_CREATE)

        setContent {
            PlaydTheme {
                var tracks by remember { mutableStateOf<List<Track>>(emptyList()) }
                var tracksLoaded by remember { mutableStateOf(false) }
                var currentTrackId by remember { mutableStateOf<Long?>(null) }

                // Wait for playerManager to be ready
                val pm = playerManager

                // Observe current track for highlighting
                LaunchedEffect(pm) {
                    pm?.currentTrack?.collect { track ->
                        currentTrackId = track?.id
                    }
                }

                // Load tracks
                LaunchedEffect(Unit) {
                    val repo = MusicRepository.getInstance(this@MainActivity)
                    // Initial scan
                    repo.scanMediaStore()
                    tracksLoaded = true
                }

                // Collect tracks based on current search/sort
                var currentSort by remember { mutableStateOf(SortOrder.TITLE) }
                var searchQuery by remember { mutableStateOf("") }

                LaunchedEffect(currentSort, searchQuery, tracksLoaded) {
                    if (!tracksLoaded) return@LaunchedEffect
                    val repo = MusicRepository.getInstance(this@MainActivity)
                    val flow = if (searchQuery.isBlank()) {
                        repo.getAllTracks(currentSort)
                    } else {
                        repo.searchTracks(searchQuery)
                    }
                    flow.collect { trackList ->
                        tracks = trackList
                    }
                }

                val navController = rememberNavController()
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentRoute = navBackStackEntry?.destination?.route

                // Handle intent (e.g., from notification)
                LaunchedEffect(intent?.action) {
                    if (intent?.action == MusicPlayerService.ACTION_OPEN_PLAYER) {
                        navController.navigate("nowPlaying")
                    }
                }

                Scaffold(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.background),
                    containerColor = MaterialTheme.colorScheme.background,
                    bottomBar = {
                        if (currentRoute != "nowPlaying") {
                            if (pm != null) {
                                MiniPlayer(
                                    playerManager = pm,
                                    onMiniPlayerClick = {
                                        navController.navigate("nowPlaying")
                                    }
                                )
                            }
                        }
                    }
                ) { paddingValues ->
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(paddingValues)
                    ) {
                        NavHost(
                            navController = navController,
                            startDestination = "library",
                            enterTransition = {
                                slideInHorizontally(
                                    initialOffsetX = { it },
                                    animationSpec = tween(300)
                                ) + fadeIn()
                            },
                            exitTransition = {
                                slideOutHorizontally(
                                    targetOffsetX = { -it / 3 },
                                    animationSpec = tween(300)
                                ) + fadeOut(animationSpec = tween(200))
                            }
                        ) {
                            composable("library") {
                                LibraryScreen(
                                    tracks = tracks,
                                    onTrackClick = { index ->
                                        if (pm != null && tracks.isNotEmpty()) {
                                            pm!!.setQueue(tracks, index)
                                        }
                                    },
                                    onSearch = { query ->
                                        searchQuery = query
                                    },
                                    onSortChange = { sort ->
                                        currentSort = sort
                                    },
                                    onToggleFavorite = { track ->
                                        lifecycleScope.launch {
                                            repository?.toggleFavorite(track)
                                        }
                                    },
                                    currentTrackId = currentTrackId
                                )
                            }

                            composable("nowPlaying") {
                                if (pm != null) {
                                    NowPlayingScreen(
                                        playerManager = pm!!,
                                        onQueueClick = {
                                            navController.navigate("queue")
                                        },
                                        onBack = {
                                            navController.popBackStack()
                                        }
                                    )
                                }
                            }

                            composable("queue") {
                                val queue by pm?.queue?.collectAsState() ?: remember { mutableStateOf(emptyList()) }
                                val qi by pm?.queueIndex?.collectAsState() ?: remember { mutableIntStateOf(-1) }

                                QueueScreen(
                                    queue = queue,
                                    currentIndex = qi,
                                    onTrackClick = { index ->
                                        pm?.let { p ->
                                            p.setQueue(queue, index)
                                        }
                                    },
                                    onClearQueue = {
                                        pm?.clearQueue()
                                    },
                                    onRemoveTrack = { index ->
                                        pm?.removeFromQueue(index)
                                    },
                                    onBack = {
                                        navController.popBackStack()
                                    }
                                )
                            }
                        }
                    }
                }

                // Request permissions on launch
                LaunchedEffect(Unit) {
                    checkAndRequestPermissions()
                }
            }
        }
    }

    override fun onDestroy() {
        if (isBound) {
            unbindService(serviceConnection)
            isBound = false
        }
        super.onDestroy()
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO)
                != PackageManager.PERMISSION_GRANTED
            ) {
                permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        } else {
            // Android 12 and below
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED
            ) {
                permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }

        if (permissions.isNotEmpty()) {
            requestPermissionLauncher.launch(permissions.toTypedArray())
        } else {
            // Already have permission, scan
            repository?.let { repo ->
                lifecycleScope.launch {
                    repo.scanMediaStore()
                }
            }
        }
    }
}
