extends Node3D

# 발사체(총알) 생성 공통 리소스
const BULLET_SCENE : PackedScene = preload("res://model/items/bullet_45/BulletProjectile.tscn")

# ===== 탄약 설정 =====
var max_ammo : int = 30
var current_ammo : int = 30
var is_firing : bool = false   # 연사 방지용 변수
var is_aiming : bool = false   # 조준(ADS) 상태

# 공격력 (다음 작업: 총알 명중 판정과 연결 예정)
@export var damage : int = 15

# WeaponManager가 무기 교체(1, 2번 키) 시 이 값을 통해 현재 활성 무기인지 확인합니다.
var is_active : bool = true

# ===== 자세(포즈) 설정 =====
# 평소(비조준) 자세는 씬에 배치된 초기 위치/회전을 그대로 idle 자세로 사용합니다.
var idle_position : Vector3
var idle_rotation_degrees : Vector3

# 조준(ADS) 시 idle 자세 대비 이동할 위치/회전 오프셋 (에디터 인스펙터에서 값 조절 가능)
@export var aim_position_offset : Vector3 = Vector3(-0.18, 0.06, 0.25)
@export var aim_rotation_offset_degrees : Vector3 = Vector3(0, 0, 0)

# 조준 시 카메라 줌(FOV) 관련 설정
@export var aim_fov : float = 40.0
@export var aim_time : float = 0.2

var default_fov : float = 75.0

# 부모 노드가 Camera3D 입니다. (world.tscn: Player/Camera3D/Bren2)
@onready var camera : Camera3D = get_parent() as Camera3D

# 화면 UI 텍스트(Label) 노드를 찾아옵니다. (m1911과 동일한 깊이의 경로)
@onready var ammo_label : Label = $"../../../CanvasLayer/Label"


func _ready() -> void:
	idle_position = position
	idle_rotation_degrees = rotation_degrees
	if camera:
		default_fov = camera.fov
	update_ammo_label()


func update_ammo_label() -> void:
	if ammo_label and is_active:
		ammo_label.text = "AMMO: " + str(current_ammo) + " / " + str(max_ammo)


# WeaponManager가 무기 전환 시 호출합니다.
func set_active(active: bool) -> void:
	is_active = active
	visible = active
	set_process_unhandled_input(active)
	if active:
		update_ammo_label()
	else:
		# 다른 총으로 바뀔 때는 조준/줌 상태를 즉시 원래대로 되돌립니다.
		if is_aiming:
			_stop_aim(false)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("RifleFire") and not is_firing:
		fire_weapon()

	if event.is_action_pressed("gun_reload") and not is_firing:
		reload_weapon()

	if event.is_action_pressed("aim"):
		_start_aim()
	elif event.is_action_released("aim"):
		_stop_aim(true)


func reload_weapon() -> void:
	print("Bren2 재장전 중..")
	current_ammo = max_ammo
	update_ammo_label()


func fire_weapon() -> void:
	if current_ammo > 0:
		current_ammo -= 1
		print("남은 탄약: ", current_ammo, " / ", max_ammo)
		update_ammo_label()

		_spawn_bullet()

		# 발사 모션(반동) 실행
		play_recoil()
	else:
		print("총알이 없습니다. 재장전이 필요합니다. (R)")


func _spawn_bullet() -> void:
	if BULLET_SCENE == null or camera == null:
		return

	var bullet := BULLET_SCENE.instantiate()
	get_tree().current_scene.add_child(bullet)
	bullet.global_transform = camera.global_transform
	bullet.global_position += -camera.global_transform.basis.z * 0.5
	bullet.damage = damage

	var shooter := camera.get_parent()
	if shooter is CollisionObject3D:
		bullet.shooter_rid = (shooter as CollisionObject3D).get_rid()


# ----- 조준(ADS): 우클릭을 누르고 있는 동안 총을 들고 화면이 확대됩니다. -----
func _start_aim() -> void:
	is_aiming = true
	var target_pos : Vector3 = idle_position + aim_position_offset
	var target_rot : Vector3 = idle_rotation_degrees + aim_rotation_offset_degrees

	var tween := create_tween().set_parallel(true)
	tween.set_trans(Tween.TRANS_SINE)
	tween.tween_property(self, "position", target_pos, aim_time)
	tween.tween_property(self, "rotation_degrees", target_rot, aim_time)

	if camera:
		var fov_tween := create_tween()
		fov_tween.set_trans(Tween.TRANS_SINE)
		fov_tween.tween_property(camera, "fov", aim_fov, aim_time)


func _stop_aim(animate: bool) -> void:
	is_aiming = false

	if animate:
		var tween := create_tween().set_parallel(true)
		tween.set_trans(Tween.TRANS_SINE)
		tween.tween_property(self, "position", idle_position, aim_time)
		tween.tween_property(self, "rotation_degrees", idle_rotation_degrees, aim_time)

		if camera:
			var fov_tween := create_tween()
			fov_tween.set_trans(Tween.TRANS_SINE)
			fov_tween.tween_property(camera, "fov", default_fov, aim_time)
	else:
		position = idle_position
		rotation_degrees = idle_rotation_degrees
		if camera:
			camera.fov = default_fov


# ----- 발사 반동 (m1911의 play_recoil 로직을 참고했습니다) -----
func play_recoil() -> void:
	is_firing = true
	var base_position : Vector3 = position
	var base_rotation : Vector3 = rotation_degrees

	var tween := create_tween().set_parallel(true)

	# --- 1단계: 발사! 순간적으로 뒤로 밀리고 위로 들림 (0.04초) ---
	tween.tween_property(self, "position:z", base_position.z - 0.08, 0.04)
	tween.tween_property(self, "position:y", base_position.y - 0.03, 0.04)
	tween.tween_property(self, "rotation_degrees:x", base_rotation.x + 6.0, 0.04)

	# --- 2단계: 복귀! 원래 자리로 천천히 돌아옴 (0.12초) ---
	var return_tween := create_tween().set_parallel(true)
	return_tween.set_trans(Tween.TRANS_SINE)
	return_tween.tween_property(self, "position:z", base_position.z, 0.12).set_delay(0.04)
	return_tween.tween_property(self, "position:y", base_position.y, 0.12).set_delay(0.04)
	return_tween.tween_property(self, "rotation_degrees:x", base_rotation.x, 0.12).set_delay(0.04)

	# 모든 반동 동작이 끝나면 연사 잠금 해제
	return_tween.finished.connect(func(): is_firing = false)
