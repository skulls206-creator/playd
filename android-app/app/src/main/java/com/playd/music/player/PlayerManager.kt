package com.playd.music.player

import android.app.Application
import android.content.ContentUris
import android.net.Uri
import android.provider.MediaStore
import com.playd.music.data.Track
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.random.Random

enum class RepeatMode { OFF, ALL, ONE }

class PlayerManager private constructor(private val app: Application) {

    companion object {
        @Volatile private var instance: PlayerManager? = null
        fun getInstance(app: Application): PlayerManager =
            instance ?: synchronized(this) { instance ?: PlayerManager(app).also { instance = it } }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _queue = MutableStateFlow<List<Track>>(emptyList())
    val queue: StateFlow<List<Track>> = _queue.asStateFlow()

    private val _currentIndex = MutableStateFlow(-1)
    val currentIndex: StateFlow<Int> = _currentIndex.asStateFlow()

    private val _currentTrack = MutableStateFlow<Track?>(null)
    val currentTrack: StateFlow<Track?> = _currentTrack.asStateFlow()

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

    private val _position = MutableStateFlow(0L)
    val position: StateFlow<Long> = _position.asStateFlow()

    private val _duration = MutableStateFlow(0L)
    val duration: StateFlow<Long> = _duration.asStateFlow()

    private val _shuffleMode = MutableStateFlow(false)
    val shuffleMode: StateFlow<Boolean> = _shuffleMode.asStateFlow()

    private val _repeatMode = MutableStateFlow(RepeatMode.OFF)
    val repeatMode: StateFlow<RepeatMode> = _repeatMode.asStateFlow()

    private var shuffleOrder: MutableList<Int> = mutableListOf()
    private var shufflePosition: Int = -1

    // ExoPlayer instance — set by MusicPlayerService
    var exoPlayer: androidx.media3.exoplayer.ExoPlayer? = null
    var service: MusicPlayerService? = null

    private val positionUpdateJob = scope.launch {
        while (isActive) {
            delay(500)
            exoPlayer?.let { player ->
                _position.value = player.currentPosition
                _duration.value = player.duration.coerceAtLeast(0)
                val playing = player.isPlaying
                if (_isPlaying.value != playing) _isPlaying.value = playing
            }
        }
    }

    fun setQueue(tracks: List<Track>, startIndex: Int = 0) {
        _queue.value = tracks
        if (_shuffleMode.value) {
            buildShuffleOrder(startIndex)
        }
        playAt(startIndex)
    }

    fun addToQueue(track: Track) {
        _queue.value = _queue.value + track
        if (_shuffleMode.value) {
            shuffleOrder.add(shuffleOrder.size)
        }
    }

    fun playAt(index: Int) {
        val q = _queue.value
        if (q.isEmpty() || index < 0 || index >= q.size) return
        _currentIndex.value = index
        _currentTrack.value = q[index]
        exoPlayer?.let { player ->
            val uri = Uri.parse(q[index].filePath)
            val mediaItem = androidx.media3.common.MediaItem.fromUri(uri)
            player.setMediaItem(mediaItem)
            player.prepare()
            player.play()
            service?.updateMediaSession(q[index])
        }
    }

    fun play() { exoPlayer?.play() }
    fun pause() { exoPlayer?.pause() }

    fun togglePlayPause() {
        if (_isPlaying.value) pause() else play()
    }

    fun next() {
        val q = _queue.value
        if (q.isEmpty()) return

        val nextIdx = if (_shuffleMode.value) {
            shufflePosition++
            if (shufflePosition >= shuffleOrder.size) {
                if (_repeatMode.value == RepeatMode.ALL) {
                    buildShuffleOrder(0)
                    shufflePosition = 0
                } else {
                    shufflePosition = shuffleOrder.size - 1
                    return
                }
            }
            shuffleOrder[shufflePosition]
        } else {
            val next = _currentIndex.value + 1
            if (next >= q.size) {
                if (_repeatMode.value == RepeatMode.ALL) 0 else return
            } else next
        }
        playAt(nextIdx)
    }

    fun previous() {
        // If more than 3s in, restart current track
        exoPlayer?.let { if (it.currentPosition > 3000) { it.seekTo(0); return } }

        val q = _queue.value
        if (q.isEmpty()) return

        val prevIdx = if (_shuffleMode.value) {
            shufflePosition--
            if (shufflePosition < 0) {
                if (_repeatMode.value == RepeatMode.ALL) {
                    buildShuffleOrder(q.size - 1)
                    shufflePosition = shuffleOrder.size - 1
                } else {
                    shufflePosition = 0
                    return
                }
            }
            shuffleOrder[shufflePosition]
        } else {
            val prev = _currentIndex.value - 1
            if (prev < 0) {
                if (_repeatMode.value == RepeatMode.ALL) q.size - 1 else return
            } else prev
        }
        playAt(prevIdx)
    }

    fun seekTo(positionMs: Long) { exoPlayer?.seekTo(positionMs) }

    fun toggleShuffle() {
        val newShuffle = !_shuffleMode.value
        _shuffleMode.value = newShuffle
        if (newShuffle) {
            buildShuffleOrder(_currentIndex.value)
        }
    }

    fun toggleRepeat() {
        _repeatMode.value = when (_repeatMode.value) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        }
    }

    // Aliases expected by UI components
    val shuffleEnabled: StateFlow<Boolean> get() = _shuffleMode
    val queueIndex: StateFlow<Int> get() = _currentIndex

    fun playPause() = togglePlayPause()
    fun skipToNext() = next()
    fun skipToPrevious() = previous()
    fun cycleRepeatMode() = toggleRepeat()

    fun clearQueue() {
        exoPlayer?.stop()
        _queue.value = emptyList()
        _currentIndex.value = -1
        _currentTrack.value = null
        shuffleOrder.clear()
        shufflePosition = -1
    }

    fun removeFromQueue(index: Int) {
        val q = _queue.value.toMutableList()
        if (index < 0 || index >= q.size) return
        q.removeAt(index)
        _queue.value = q
        // Adjust current index if needed
        val ci = _currentIndex.value
        when {
            index < ci -> _currentIndex.value = ci - 1
            index == ci -> {
                if (q.isEmpty()) {
                    _currentIndex.value = -1
                    _currentTrack.value = null
                    exoPlayer?.stop()
                } else if (ci >= q.size) {
                    playAt(q.size - 1)
                } else {
                    playAt(ci)
                }
            }
        }
    }

    fun onTrackEnded() {
        when (_repeatMode.value) {
            RepeatMode.ONE -> {
                exoPlayer?.seekTo(0)
                exoPlayer?.play()
            }
            else -> next()
        }
    }

    private fun buildShuffleOrder(currentIndex: Int) {
        val indices = (0 until _queue.value.size).toMutableList()
        if (currentIndex in indices) {
            indices.remove(currentIndex)
            indices.shuffle(Random)
            indices.add(0, currentIndex)
        } else {
            indices.shuffle(Random)
        }
        shuffleOrder = indices
        shufflePosition = 0
    }

    fun release() {
        scope.cancel()
        exoPlayer = null
        service = null
    }
}
