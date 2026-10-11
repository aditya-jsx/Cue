import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'

// The logo's "Cue" as one pen stroke (C, then u, then e), traced over assets/images/cue_icon.jpg at 2000px.
const CUE_STROKE =
  'M 792 908 C 844 861 886 795 880 724 C 875 663 834 643 793 645 C 669 648 546 734 453 866 ' +
  'C 370 982 350 1099 360 1190 C 370 1291 432 1357 525 1360 C 649 1362 793 1261 896 1139 ' +
  'C 937 1089 978 997 1014 932 C 978 997 922 1119 916 1190 C 911 1241 937 1256 968 1254 ' +
  'C 1040 1251 1153 1089 1225 932 C 1194 997 1138 1119 1133 1190 C 1130 1236 1153 1253 1184 1253 ' +
  'C 1236 1246 1277 1180 1308 1134 C 1400 1109 1514 1058 1543 987 C 1560 932 1514 916 1473 925 ' +
  'C 1390 942 1318 1058 1320 1160 C 1323 1230 1370 1259 1431 1256 C 1514 1251 1596 1170 1662 1086'
const STROKE_LENGTH = 4600 // a little over the path's length, so the dash covers it

const AnimatedPath = Animated.createAnimatedComponent(Path)

// Shown once per launch over a black screen (the native splash is plain black), then fades into the app.
export function CueIntro() {
  const [done, setDone] = useState(false)
  const drawn = useSharedValue(0)
  const shown = useSharedValue(1)

  useEffect(() => {
    drawn.value = withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) })
    shown.value = withDelay(
      1800,
      withTiming(0, { duration: 350 }, (finished) => finished && runOnJS(setDone)(true)),
    )
  }, [drawn, shown])

  const strokeProps = useAnimatedProps(() => ({ strokeDashoffset: STROKE_LENGTH * (1 - drawn.value) }))
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }))

  if (done) return null
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.screen, fade]}>
      <Svg width="72%" style={{ aspectRatio: 1450 / 850 }} viewBox="300 580 1450 850">
        <AnimatedPath
          animatedProps={strokeProps}
          d={CUE_STROKE}
          fill="none"
          stroke="#fff"
          strokeDasharray={STROKE_LENGTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={64}
        />
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { alignItems: 'center', backgroundColor: '#000', justifyContent: 'center', zIndex: 100 },
})
